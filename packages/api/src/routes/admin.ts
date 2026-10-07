import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PERMISOS_IDS, ROLES_BASE, esPermiso, formSchema, type Permiso } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { borrarSiHuerfano, guardar, urlPublica } from '../lib/media.js';
import { audit, olvidarPermisos, requireAuth, requirePermiso, tiene } from '../lib/auth.js';
import { generatePublicKey, generateSecretKey, hashKey } from '../lib/keys.js';
import { captureLead } from '../services/capture.js';
import { sumarIntereses, validarIntereses } from '../services/intereses.js';
import { cifrar, pista } from '../lib/secretos.js';
import { guardarAjustes, leerAjustes } from '../lib/ajustes.js';
import { env } from '../env.js';

/** Gestión: proyectos, unidades, formularios, sitios, usuarios, etapas. */
export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  /**
   * Un preHandler por área, no un «gestión» genérico: así un rol personalizado puede
   * configurar canales sin tocar usuarios, o editar inventario sin ver precios.
   */
  const embudo = requirePermiso('embudo.configurar');
  const inventario = requirePermiso('inventario.editar');
  const usuarios = requirePermiso('usuarios.gestionar');
  const canales = requirePermiso('canales.configurar');
  const exportar = requirePermiso('leads.exportar');
  /** La lista de usuarios la necesita quien filtra por asesor, no solo quien los gestiona. */
  const veEquipo = requirePermiso('usuarios.gestionar', 'leads.ver_todos', 'leads.reasignar');

  // ------------------------------------------------------------- etapas
  app.get('/stages', async (req) =>
    prisma.stage.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { position: 'asc' },
      include: { _count: { select: { leads: true } } },
    })
  );

  /**
   * Las etapas son del cliente, no del código: una inmobiliaria vende con «Visita» y
   * «Separación», una agencia con «Reunión» y «Propuesta enviada».
   *
   * Reglas que el CRM necesita para no romperse:
   * - La PRIMERA etapa es la que recibe los leads nuevos (`captureLead` toma la de menor
   *   posición), así que reordenar cambia a dónde entran.
   * - Ganada y perdida son excluyentes; los reportes cuentan como ganado lo que está en una
   *   etapa ganada.
   * - El slug se fija al crearla y no cambia al renombrar: es el nombre estable de la etapa.
   */
  const stageInput = z
    .object({
      name: z.string().trim().min(1).max(60),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
      isWon: z.boolean().optional(),
      isLost: z.boolean().optional(),
    })
    .refine((v) => !(v.isWon && v.isLost), { message: 'Una etapa no puede ser ganada y perdida' });

  const ENTRADA_CERRADA =
    'La primera etapa recibe los leads nuevos: no puede ser ganada ni perdida, o cada lead que entre contaría como cerrado.';

  /** La etapa de menor posición de la organización, que es por donde entran los leads. */
  async function etapaDeEntrada(orgId: string) {
    return prisma.stage.findFirst({ where: { organizationId: orgId }, orderBy: { position: 'asc' } });
  }

  function slugDe(nombre: string) {
    return (
      nombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50) || 'etapa'
    );
  }

  app.post('/stages', { preHandler: embudo }, async (req, reply) => {
    const parsed = stageInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
    }
    const orgId = req.user!.organizationId;
    const existentes = await prisma.stage.findMany({
      where: { organizationId: orgId },
      select: { slug: true, position: true },
    });
    const base = slugDe(parsed.data.name);
    let slug = base;
    for (let i = 2; existentes.some((e) => e.slug === slug); i++) slug = `${base}-${i}`;

    const etapa = await prisma.stage.create({
      data: {
        organizationId: orgId,
        slug,
        name: parsed.data.name,
        color: parsed.data.color ?? null,
        isWon: parsed.data.isWon ?? false,
        isLost: parsed.data.isLost ?? false,
        position: Math.max(0, ...existentes.map((e) => e.position)) + 1,
      },
    });
    await audit(orgId, req.user!.id, 'stage.create', { entity: 'stage', entityId: etapa.id });
    return etapa;
  });

  app.patch<{ Params: { id: string } }>('/stages/:id', { preHandler: embudo }, async (req, reply) => {
    const parsed = stageInput.innerType().partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const etapa = await prisma.stage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!etapa) return reply.code(404).send({ error: 'Etapa no encontrada' });

    // Marcar una apaga la otra, en vez de rechazar: es lo que quien hace clic quiere decir.
    const data = { ...parsed.data };
    if (data.isWon) data.isLost = false;
    if (data.isLost) data.isWon = false;
    if ((data.isWon || data.isLost) && (await etapaDeEntrada(etapa.organizationId))?.id === etapa.id) {
      return reply.code(409).send({ error: ENTRADA_CERRADA });
    }
    return prisma.stage.update({ where: { id: etapa.id }, data });
  });

  /** Nuevo orden: la lista completa de ids de la organización, de primera a última. */
  app.put('/stages/order', { preHandler: embudo }, async (req, reply) => {
    const parsed = z.object({ ids: z.array(z.string()).min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const orgId = req.user!.organizationId;
    const actuales = await prisma.stage.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const ids = parsed.data.ids;
    // Tiene que ser exactamente el mismo conjunto: ni etapas de otro cliente ni huecos.
    if (ids.length !== actuales.length || new Set(ids).size !== ids.length || !actuales.every((a) => ids.includes(a.id))) {
      return reply.code(400).send({ error: 'El orden debe incluir todas las etapas una sola vez' });
    }
    const primera = await prisma.stage.findUnique({ where: { id: ids[0]! } });
    if (primera?.isWon || primera?.isLost) return reply.code(409).send({ error: ENTRADA_CERRADA });
    await prisma.$transaction(
      ids.map((id, i) => prisma.stage.update({ where: { id }, data: { position: i + 1 } }))
    );
    await audit(orgId, req.user!.id, 'stage.reorder', { meta: { ids } });
    return { ok: true };
  });

  /**
   * Borrar una etapa. Si tiene leads, hay que decir a cuál pasan: la relación es `SetNull`
   * y un lead sin etapa desaparece del embudo y de los reportes sin que nadie lo note.
   */
  app.delete<{ Params: { id: string }; Querystring: { moverA?: string } }>(
    '/stages/:id',
    { preHandler: embudo },
    async (req, reply) => {
      const orgId = req.user!.organizationId;
      const etapa = await prisma.stage.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: { _count: { select: { leads: true } } },
      });
      if (!etapa) return reply.code(404).send({ error: 'Etapa no encontrada' });
      const orden = await prisma.stage.findMany({
        where: { organizationId: orgId },
        orderBy: { position: 'asc' },
      });
      if (orden.length <= 1) return reply.code(409).send({ error: 'Tiene que quedar al menos una etapa' });
      // Borrar la de entrada deja como entrada a la siguiente: tiene que poder serlo.
      if (orden[0]!.id === etapa.id && (orden[1]!.isWon || orden[1]!.isLost)) {
        return reply.code(409).send({ error: ENTRADA_CERRADA });
      }

      let destino: { id: string; name: string } | null = null;
      if (etapa._count.leads > 0) {
        const moverA = req.query.moverA;
        if (!moverA || moverA === etapa.id) {
          return reply.code(409).send({
            error: `La etapa tiene ${etapa._count.leads} leads. Elige a qué etapa pasan.`,
          });
        }
        destino = await prisma.stage.findFirst({
          where: { id: moverA, organizationId: orgId },
          select: { id: true, name: true },
        });
        if (!destino) return reply.code(400).send({ error: 'Etapa de destino inválida' });
      }

      await prisma.$transaction(async (tx) => {
        if (destino) {
          const leads = await tx.lead.findMany({ where: { stageId: etapa.id }, select: { id: true } });
          await tx.lead.updateMany({ where: { stageId: etapa.id }, data: { stageId: destino.id } });
          // Que el historial de cada lead explique por qué cambió de etapa.
          await tx.activity.createMany({
            data: leads.map((l) => ({
              leadId: l.id,
              userId: req.user!.id,
              type: 'cambio_etapa' as const,
              body: `Etapa → ${destino!.name} (se eliminó «${etapa.name}»)`,
            })),
          });
        }
        await tx.stage.delete({ where: { id: etapa.id } });
      });
      await audit(orgId, req.user!.id, 'stage.delete', {
        entity: 'stage',
        entityId: etapa.id,
        meta: { name: etapa.name, movidos: etapa._count.leads, destino: destino?.id },
      });
      return { ok: true, movidos: etapa._count.leads };
    }
  );

  // ------------------------------------------------------ preferencias
  /**
   * Preferencias de la organización. Con ellas va si el servidor tiene las claves: prender
   * la transcripción sin `OPENAI_API_KEY` solo produciría notas con error.
   */
  app.get('/ajustes', { preHandler: embudo }, async (req) => ({
    ...(await leerAjustes(req.user!.organizationId)),
    servidor: { openai: !!env.voz.openaiKey, claude: env.voz.claudeActivo },
  }));

  /** Lo que cualquier usuario necesita de los ajustes para operar (el asesor mueve leads a perdido). */
  app.get('/ajustes/operacion', async (req) => {
    const a = await leerAjustes(req.user!.organizationId);
    return { motivosPerdida: a.motivosPerdida, nivelesInteres: a.nivelesInteres };
  });

  app.patch('/ajustes', { preHandler: embudo }, async (req, reply) => {
    const parsed = z
      .object({
        transcribirVoz: z.boolean().optional(),
        motivosPerdida: z.array(z.string().trim().min(1).max(120)).max(30).optional(),
        descuentoMaximoPct: z.number().min(0).max(100).nullable().optional(),
        nivelesInteres: z.tuple([z.string().trim().min(1).max(30), z.string().trim().min(1).max(30), z.string().trim().min(1).max(30)]).optional(),
      })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const ajustes = await guardarAjustes(req.user!.organizationId, parsed.data);
    await audit(req.user!.organizationId, req.user!.id, 'org.ajustes', { meta: parsed.data });
    return ajustes;
  });

  // ---------------------------------------------------------- proyectos
  app.get('/projects', async (req) =>
    prisma.project.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { units: true, leads: true } } },
      orderBy: { name: 'asc' },
    })
  );

  const projectInput = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    code: z.string().optional(),
    address: z.string().optional(),
  });

  app.post('/projects', { preHandler: inventario }, async (req, reply) => {
    const parsed = projectInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    return prisma.project.create({
      data: { ...parsed.data, organizationId: req.user!.organizationId },
    });
  });

  // --------------------------------------------------------- tipologías

  app.get<{ Params: { id: string } }>('/projects/:id/typologies', async (req) => {
    const tipologias = await prisma.typology.findMany({
      where: { projectId: req.params.id, project: { organizationId: req.user!.organizationId } },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { units: true } } },
    });
    // En la base va la ruta relativa; al navegador se le da la URL ya resuelta.
    return tipologias.map((t) => ({
      ...t,
      planUrl: urlPublica(t.planUrl),
      imageUrl: urlPublica(t.imageUrl),
    }));
  });

  const typologyInput = z.object({
    name: z.string().min(1),
    code: z.string().optional(),
    bedrooms: z.number().int().optional(),
    bathrooms: z.number().int().optional(),
    areaM2: z.number().optional(),
    priceFrom: z.number().optional(),
    currency: z.string().default('PEN'),
    description: z.string().optional(),
    planUrl: z.string().url().optional().or(z.literal('')),
    imageUrl: z.string().url().optional().or(z.literal('')),
    position: z.number().int().optional(),
    active: z.boolean().optional(),
  });

  app.post<{ Params: { id: string } }>('/projects/:id/typologies', { preHandler: inventario }, async (req, reply) => {
    const parsed = typologyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!project) return reply.code(404).send({ error: 'Proyecto no encontrado' });
    return prisma.typology.create({ data: { ...parsed.data, projectId: project.id } });
  });

  app.patch<{ Params: { id: string } }>('/typologies/:id', { preHandler: inventario }, async (req, reply) => {
    const parsed = typologyInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const tip = await prisma.typology.findFirst({
      where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
    });
    if (!tip) return reply.code(404).send({ error: 'Tipología no encontrada' });
    if (parsed.data.priceFrom !== undefined && String(parsed.data.priceFrom) !== String(tip.priceFrom ?? '') && !tiene(req.user, 'inventario.precios')) {
      return reply.code(403).send({ error: 'Sin permiso para cambiar precios de lista' });
    }
    const actualizada = await prisma.typology.update({ where: { id: tip.id }, data: parsed.data });
    if (parsed.data.priceFrom !== undefined && String(parsed.data.priceFrom) !== String(tip.priceFrom ?? '')) {
      await audit(req.user!.organizationId, req.user!.id, 'typology.price', {
        entity: 'typology',
        entityId: tip.id,
        meta: { name: tip.name, projectId: tip.projectId, de: tip.priceFrom, a: parsed.data.priceFrom },
        ip: req.ip,
      });
    }
    return actualizada;
  });

  /**
   * Borrar una tipología.
   *
   * Las unidades no se tocan: la relación es `SetNull`, así que quedan sin tipología en vez
   * de desaparecer del inventario. Se avisa cuántas quedan sueltas para que quien borra lo
   * sepa antes de irse.
   */
  app.delete<{ Params: { id: string } }>('/typologies/:id', { preHandler: inventario }, async (req, reply) => {
    const tip = await prisma.typology.findFirst({
      where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
      include: { _count: { select: { units: true } } },
    });
    if (!tip) return reply.code(404).send({ error: 'Tipología no encontrada' });
    await prisma.typology.delete({ where: { id: tip.id } });
    return { ok: true, unidadesSinTipologia: tip._count.units };
  });

  /**
   * Subida del plano o el render de una tipología.
   *
   * Un solo archivo por petición y un solo campo, para que el endpoint sea aburrido: los
   * formularios de subida son de los sitios más atacados de cualquier panel.
   */
  app.post<{ Params: { id: string }; Querystring: { campo?: string } }>(
    '/typologies/:id/media',
    { preHandler: inventario },
    async (req, reply) => {
      const campo = req.query.campo === 'imageUrl' ? 'imageUrl' : 'planUrl';

      const tip = await prisma.typology.findFirst({
        where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
      });
      if (!tip) return reply.code(404).send({ error: 'Tipología no encontrada' });

      const archivo = await req.file();
      if (!archivo) return reply.code(400).send({ error: 'No llegó ningún archivo.' });

      let contenido: Buffer;
      try {
        contenido = await archivo.toBuffer();
      } catch {
        return reply.code(413).send({ error: 'El archivo es demasiado grande.' });
      }

      const res = await guardar(req.user!.organizationId, contenido, archivo.mimetype);
      if ('error' in res) return reply.code(400).send({ error: res.error });

      const anterior = tip[campo];
      const actualizada = await prisma.typology.update({
        where: { id: tip.id },
        data: { [campo]: res.ruta },
      });

      // El anterior puede seguir en uso: el nombre es el hash del contenido, así que dos
      // tipologías con el mismo plano comparten archivo.
      if (anterior && anterior !== res.ruta) {
        const enUso = await prisma.typology.count({
          where: { OR: [{ planUrl: anterior }, { imageUrl: anterior }] },
        });
        await borrarSiHuerfano(anterior, enUso > 0);
      }

      return { ...actualizada, [campo]: res.ruta, url: urlPublica(res.ruta), bytes: res.bytes };
    }
  );

  // ----------------------------------------------------------- unidades
  app.get<{ Params: { id: string } }>('/projects/:id/units', async (req) =>
    prisma.unit.findMany({
      where: { projectId: req.params.id, project: { organizationId: req.user!.organizationId } },
      orderBy: { code: 'asc' },
      include: { typologyRef: { select: { id: true, name: true } } },
    })
  );

  const unitInput = z.object({
    code: z.string().min(1),
    typologyId: z.string().optional().or(z.literal('')),
    typology: z.string().optional(),
    kind: z.enum(['departamento', 'estacionamiento', 'deposito', 'lote', 'oficina', 'otro']).default('departamento'),
    status: z.enum(['disponible', 'reservado', 'vendido', 'no_disponible']).default('disponible'),
    bedrooms: z.number().int().optional(),
    areaM2: z.number().optional(),
    price: z.number().optional(),
    currency: z.string().default('PEN'),
    floor: z.number().int().optional(),
  });

  app.post<{ Params: { id: string } }>('/projects/:id/units', { preHandler: inventario }, async (req, reply) => {
    const parsed = unitInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!project) return reply.code(404).send({ error: 'Proyecto no encontrado' });
    // Un select vacío llega como cadena vacía y rompería la clave foránea.
    const { typologyId, ...resto } = parsed.data;
    return prisma.unit.create({
      data: { ...resto, typologyId: typologyId || null, projectId: project.id },
    });
  });

  /**
   * Importación masiva de unidades.
   *
   * Cargar un edificio de 80 departamentos a mano no es razonable, y el inventario suele
   * llegar en un Excel del cliente. El CSV se convierte a filas en el navegador y aquí solo
   * se valida y se guarda.
   *
   * Dos decisiones que hacen que se pueda repetir sin miedo:
   *
   *  - **Se hace upsert por `(proyecto, código)`**, que ya es único. Reimportar el mismo
   *    archivo actualiza en vez de fallar a mitad, y es lo que permite usar la importación
   *    también para actualizar precios y estados, que es lo que el cliente manda cada mes.
   *  - **Las filas malas no abortan el lote.** Se importan las buenas y se devuelve el
   *    detalle de las que no, con su número de línea. Un archivo de 80 filas con dos
   *    erratas debe cargar 78, no cero.
   */
  app.post<{ Params: { id: string } }>('/projects/:id/units/import', { preHandler: inventario }, async (req, reply) => {
    const entrada = z
      .object({
        crearTipologias: z.boolean().default(true),
        filas: z.array(z.record(z.string())).min(1).max(2000),
      })
      .safeParse(req.body);
    if (!entrada.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!project) return reply.code(404).send({ error: 'Proyecto no encontrado' });

    const tipologias = await prisma.typology.findMany({ where: { projectId: project.id } });
    const porNombre = new Map(tipologias.map((t) => [t.name.trim().toLowerCase(), t]));

    const numero = (v: string | undefined) => {
      if (v === undefined) return undefined;
      const limpio = v.replace(/[^0-9.,-]/g, '').replace(',', '.');
      if (limpio === '') return undefined;
      const n = Number(limpio);
      return Number.isFinite(n) ? n : undefined;
    };

    const KIND = ['departamento', 'estacionamiento', 'deposito', 'lote', 'oficina', 'otro'];
    const STATUS = ['disponible', 'reservado', 'vendido', 'no_disponible'];

    let creadas = 0;
    let actualizadas = 0;
    const tipologiasCreadas: string[] = [];
    const errores: { linea: number; codigo: string; motivo: string }[] = [];

    for (let i = 0; i < entrada.data.filas.length; i += 1) {
      const fila = entrada.data.filas[i];
      const linea = i + 2; // +1 por el índice, +1 por la cabecera del archivo
      const code = (fila.codigo ?? '').trim();

      if (!code) {
        errores.push({ linea, codigo: '', motivo: 'Falta el código de la unidad' });
        continue;
      }

      const kind = (fila.tipo ?? 'departamento').trim().toLowerCase();
      const status = (fila.estado ?? 'disponible').trim().toLowerCase();
      if (!KIND.includes(kind)) {
        errores.push({ linea, codigo: code, motivo: `Tipo no reconocido: "${fila.tipo}"` });
        continue;
      }
      if (!STATUS.includes(status)) {
        errores.push({ linea, codigo: code, motivo: `Estado no reconocido: "${fila.estado}"` });
        continue;
      }

      // Tipología por nombre. Se crea si falta y así se pidió, para no obligar a darla de
      // alta a mano antes de importar.
      let typologyId: string | null = null;
      const nombreTip = (fila.tipologia ?? '').trim();
      if (nombreTip) {
        const clave = nombreTip.toLowerCase();
        let tip = porNombre.get(clave);
        if (!tip && entrada.data.crearTipologias) {
          tip = await prisma.typology.create({
            data: {
              projectId: project.id,
              name: nombreTip,
              bedrooms: numero(fila.dormitorios),
              areaM2: numero(fila.area_m2),
            },
          });
          porNombre.set(clave, tip);
          tipologiasCreadas.push(nombreTip);
        }
        if (!tip) {
          errores.push({ linea, codigo: code, motivo: `La tipología "${nombreTip}" no existe` });
          continue;
        }
        typologyId = tip.id;
      }

      const datos = {
        typologyId,
        typology: nombreTip || null,
        kind: kind as never,
        status: status as never,
        bedrooms: numero(fila.dormitorios),
        areaM2: numero(fila.area_m2),
        price: numero(fila.precio),
        currency: (fila.moneda ?? 'PEN').trim().toUpperCase() || 'PEN',
        floor: numero(fila.piso),
      };

      try {
        const existente = await prisma.unit.findFirst({
          where: { projectId: project.id, code },
          select: { id: true },
        });
        if (existente) {
          await prisma.unit.update({ where: { id: existente.id }, data: datos });
          actualizadas += 1;
        } else {
          await prisma.unit.create({ data: { ...datos, code, projectId: project.id } });
          creadas += 1;
        }
      } catch (err) {
        errores.push({
          linea,
          codigo: code,
          motivo: err instanceof Error ? err.message.split('\n')[0] : 'Error al guardar',
        });
      }
    }

    return { creadas, actualizadas, tipologiasCreadas, errores };
  });

  app.patch<{ Params: { id: string } }>('/units/:id', { preHandler: inventario }, async (req, reply) => {
    const parsed = unitInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const unit = await prisma.unit.findFirst({
      where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
    });
    if (!unit) return reply.code(404).send({ error: 'Unidad no encontrada' });
    const { typologyId, ...resto } = parsed.data;
    if (resto.price !== undefined && String(resto.price) !== String(unit.price ?? '') && !tiene(req.user, 'inventario.precios')) {
      return reply.code(403).send({ error: 'Sin permiso para cambiar precios de lista' });
    }
    const actualizada = await prisma.unit.update({
      where: { id: unit.id },
      data: { ...resto, ...(typologyId === undefined ? {} : { typologyId: typologyId || null }) },
    });
    /**
     * Quién cambió el precio de lista y de cuánto a cuánto. Sperant no deja al cliente tocar
     * precios por una mala experiencia; aquí sí se puede, pero solo con `inventario.precios` y
     * con rastro. Es lo que hace defendible la decisión ante el dueño del proyecto.
     */
    if (resto.price !== undefined && String(resto.price) !== String(unit.price ?? '')) {
      await audit(req.user!.organizationId, req.user!.id, 'unit.price', {
        entity: 'unit',
        entityId: unit.id,
        meta: { code: unit.code, projectId: unit.projectId, de: unit.price, a: resto.price },
        ip: req.ip,
      });
    }
    return actualizada;
  });

  // -------------------------------------------------------- formularios
  app.get('/forms', async (req) =>
    prisma.form.findMany({
      where: { organizationId: req.user!.organizationId },
      include: {
        project: { select: { id: true, name: true } },
        site: { select: { id: true, name: true } },
        _count: { select: { submissions: true } },
      },
      orderBy: { updatedAt: 'desc' },
    })
  );

  app.get<{ Params: { id: string } }>('/forms/:id', async (req, reply) => {
    const form = await prisma.form.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!form) return reply.code(404).send({ error: 'Formulario no encontrado' });
    return form;
  });

  const formInput = z.object({
    name: z.string().min(1),
    projectId: z.string().nullable().optional(),
    siteId: z.string().nullable().optional(),
    notifyEmails: z.array(z.string().email()).default([]),
    schema: formSchema,
  });

  app.post('/forms', { preHandler: canales }, async (req, reply) => {
    const parsed = formInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Esquema inválido', detail: parsed.error.flatten() });
    }
    const { schema, notifyEmails, ...resto } = parsed.data;
    return prisma.form.create({
      data: {
        ...resto,
        organizationId: req.user!.organizationId,
        schema: schema as never,
        notifyEmails: notifyEmails as never,
      },
    });
  });

  /** Cada cambio sube `version`: es lo que invalida la caché del conector. */
  app.put<{ Params: { id: string } }>('/forms/:id', { preHandler: canales }, async (req, reply) => {
    const parsed = formInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Esquema inválido', detail: parsed.error.flatten() });
    }
    const form = await prisma.form.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!form) return reply.code(404).send({ error: 'Formulario no encontrado' });

    const { schema, notifyEmails, ...resto } = parsed.data;
    return prisma.form.update({
      where: { id: form.id },
      data: {
        ...resto,
        schema: schema as never,
        notifyEmails: notifyEmails as never,
        version: { increment: 1 },
      },
    });
  });

  // -------------------------------------------------------------- sitios
  app.get('/sites', { preHandler: canales }, async (req) => {
    const sites = await prisma.site.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    // La secret key no se devuelve nunca: solo se ve una vez, al generarla.
    return sites.map(({ secretKeyHash, ...s }) => s);
  });

  app.post('/sites', { preHandler: canales }, async (req, reply) => {
    const parsed = z
      .object({ name: z.string().min(1), allowedOrigins: z.array(z.string()).min(1) })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const publicKey = generatePublicKey();
    const secretKey = generateSecretKey();
    const site = await prisma.site.create({
      data: {
        organizationId: req.user!.organizationId,
        name: parsed.data.name,
        publicKey,
        secretKeyHash: hashKey(secretKey),
        allowedOrigins: parsed.data.allowedOrigins as never,
      },
    });
    await audit(req.user!.organizationId, req.user!.id, 'keys.create', { entity: 'site', entityId: site.id });
    // Única vez que la secret key viaja al cliente.
    return { ...site, secretKeyHash: undefined, secretKey };
  });

  app.post<{ Params: { id: string } }>('/sites/:id/rotate', { preHandler: canales }, async (req, reply) => {
    const site = await prisma.site.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!site) return reply.code(404).send({ error: 'Sitio no encontrado' });
    const secretKey = generateSecretKey();
    await prisma.site.update({ where: { id: site.id }, data: { secretKeyHash: hashKey(secretKey) } });
    await audit(req.user!.organizationId, req.user!.id, 'keys.rotate', { entity: 'site', entityId: site.id });
    return { secretKey };
  });

  // ------------------------------------------------------------ usuarios
  app.get('/users', { preHandler: veEquipo }, async (req) =>
    prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, maxDiscountPct: true, customRoleId: true, customRole: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    })
  );

  app.post('/users', { preHandler: usuarios }, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).default('asesor'),
        customRoleId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (parsed.data.customRoleId && !(await rolPropio(req.user!.organizationId, parsed.data.customRoleId))) {
      return reply.code(400).send({ error: 'Rol inválido' });
    }
    // Solo un Admin Lucuma puede nombrar a otro: el rol existe para Lucuma, no para el cliente.
    if (parsed.data.role === 'admin_lucuma' && req.user!.role !== 'admin_lucuma') {
      return reply.code(403).send({ error: 'Solo Lucuma puede crear administradores Lucuma' });
    }
    return prisma.user.create({
      data: {
        ...parsed.data,
        customRoleId: parsed.data.customRoleId || null,
        email: parsed.data.email.toLowerCase(),
        organizationId: req.user!.organizationId,
      },
      select: { id: true, name: true, email: true, role: true, active: true, customRoleId: true },
    });
  });

  /**
   * Activar/desactivar un usuario y cambiar su rol.
   *
   * No hay borrado: un usuario aparece en asignaciones, actividades y auditoría, y
   * borrarlo dejaría el historial sin dueño justo donde importa saber quién hizo qué.
   * Desactivar le quita el acceso (el magic link exige `active`) y lo saca del reparto
   * automático de leads (`pickOwner` solo mira activos), que es lo que se busca.
   */
  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: usuarios }, async (req, reply) => {
    const parsed = z
      .object({
        active: z.boolean().optional(),
        role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).optional(),
        // Tope de descuento en proformas. Null = usar el de la organización.
        maxDiscountPct: z.number().min(0).max(100).nullable().optional(),
        // Rol personalizado; null vuelve al rol base.
        customRoleId: z.string().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    if (parsed.data.customRoleId && !(await rolPropio(req.user!.organizationId, parsed.data.customRoleId))) {
      return reply.code(400).send({ error: 'Rol inválido' });
    }
    if (parsed.data.role === 'admin_lucuma' && req.user!.role !== 'admin_lucuma') {
      return reply.code(403).send({ error: 'Solo Lucuma puede nombrar administradores Lucuma' });
    }

    const objetivo = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!objetivo) return reply.code(404).send({ error: 'Usuario no encontrado' });

    // Quedarse sin ningún administrador activo deja la organización sin quien gestione.
    if (parsed.data.active === false || (parsed.data.role && parsed.data.role !== 'admin_lucuma')) {
      if (objetivo.role === 'admin_lucuma') {
        const otros = await prisma.user.count({
          where: {
            organizationId: req.user!.organizationId,
            role: 'admin_lucuma',
            active: true,
            id: { not: objetivo.id },
          },
        });
        if (otros === 0) {
          return reply.code(409).send({
            error: 'Es el único administrador activo. Crea o activa otro antes de cambiarlo.',
          });
        }
      }
    }

    const actualizado = await prisma.user.update({
      where: { id: objetivo.id },
      data: parsed.data,
      select: { id: true, name: true, email: true, role: true, active: true, maxDiscountPct: true, customRoleId: true },
    });
    olvidarPermisos(objetivo.id);
    return actualizado;
  });

  // --------------------------------------------------- meta lead ads
  /**
   * Páginas de Facebook conectadas. El page access token no vuelve nunca al navegador:
   * se muestra solo una pista de sus últimos caracteres, para saber cuál está cargado.
   */
  app.get('/meta/pages', { preHandler: canales }, async (req) => {
    const paginas = await prisma.metaPage.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });
    return paginas.map(({ accessTokenEnc, ...p }) => ({ ...p, tokenHint: pista(accessTokenEnc) }));
  });

  const paginaMeta = z.object({
    pageId: z.string().regex(/^\d{5,}$/, 'El ID de la página son solo dígitos'),
    pageName: z.string().min(1),
    // Se limpian espacios y saltos: copiar un token de un correo o de un chat suele
    // arrastrarlos, y Meta responde "Malformed access token" sin decir que sobra un espacio.
    accessToken: z.string().transform((v) => v.replace(/\s+/g, '')).pipe(z.string().min(20)),
    projectId: z.string().optional().nullable(),
    formMap: z.record(z.string()).optional(),
    notifyEmails: z.array(z.string().email()).optional(),
  });

  app.post('/meta/pages', { preHandler: canales }, async (req, reply) => {
    const parsed = paginaMeta.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const { accessToken, projectId, ...resto } = parsed.data;

    // El pageId es único en toda la instalación: si ya existe, o es un duplicado del
    // mismo cliente o alguien está intentando desviar los leads de otro. No se dice cuál.
    const ocupada = await prisma.metaPage.findUnique({ where: { pageId: resto.pageId } });
    if (ocupada) return reply.code(409).send({ error: 'Esa página ya está conectada.' });

    // Acepta también un token de usuario: el CRM canjea el de la página (ver services/meta.ts).
    const { resolverTokenDePagina, suscribirAppAPagina } = await import('../services/meta.js');
    const tokenPagina = await resolverTokenDePagina(resto.pageId, accessToken);
    // Tercera capa de las cuatro: antes se hacía a mano en el Explorador y se olvidaba.
    const errorSuscripcion = await suscribirAppAPagina(resto.pageId, tokenPagina);

    const pagina = await prisma.metaPage.create({
      data: {
        organizationId: req.user!.organizationId,
        ...resto,
        projectId: await proyectoValido(req.user!.organizationId, projectId),
        accessTokenEnc: cifrar(tokenPagina),
        lastError: errorSuscripcion ? `No se pudo suscribir la app a la página: ${errorSuscripcion}` : null,
        formMap: (resto.formMap ?? undefined) as never,
        notifyEmails: (resto.notifyEmails ?? undefined) as never,
      },
    });
    await audit(req.user!.organizationId, req.user!.id, 'meta.page.connect', {
      entity: 'meta_page',
      entityId: pagina.id,
      meta: { pageId: pagina.pageId },
      ip: req.ip,
    });
    const { accessTokenEnc, ...salida } = pagina;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.patch<{ Params: { id: string } }>('/meta/pages/:id', { preHandler: canales }, async (req, reply) => {
    const parsed = paginaMeta.partial().omit({ pageId: true }).extend({ active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const pagina = await prisma.metaPage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!pagina) return reply.code(404).send({ error: 'Página no encontrada' });

    const { accessToken, projectId, formMap, notifyEmails, ...resto } = parsed.data;
    const actualizada = await prisma.metaPage.update({
      where: { id: pagina.id },
      data: {
        ...resto,
        ...(projectId !== undefined
          ? { projectId: await proyectoValido(req.user!.organizationId, projectId) }
          : {}),
        ...(formMap !== undefined ? { formMap: formMap as never } : {}),
        ...(notifyEmails !== undefined ? { notifyEmails: notifyEmails as never } : {}),
        // Un token nuevo borra el último error: es lo que se venía a arreglar.
        ...(accessToken
          ? {
              accessTokenEnc: cifrar(
                await (await import('../services/meta.js')).resolverTokenDePagina(
                  pagina.pageId,
                  accessToken
                )
              ),
              lastError: null,
            }
          : {}),
      },
    });
    const { accessTokenEnc, ...salida } = actualizada;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.delete<{ Params: { id: string } }>('/meta/pages/:id', { preHandler: canales }, async (req, reply) => {
    const pagina = await prisma.metaPage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!pagina) return reply.code(404).send({ error: 'Página no encontrada' });
    await prisma.metaPage.delete({ where: { id: pagina.id } });
    await audit(req.user!.organizationId, req.user!.id, 'meta.page.disconnect', {
      entity: 'meta_page', entityId: pagina.id, meta: { pageId: pagina.pageId }, ip: req.ip,
    });
    return { ok: true };
  });

  /**
   * Prueba del token contra el Graph API.
   *
   * Vale la pena tenerla porque el fallo típico de este canal —el token caducó o le
   * quitaron el permiso— es invisible: el webhook sigue llegando y los leads se quedan
   * en la cola. Aquí se ve en el momento.
   */
  app.get<{ Params: { id: string } }>('/meta/pages/:id/test', { preHandler: canales }, async (req, reply) => {
    const pagina = await prisma.metaPage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!pagina) return reply.code(404).send({ error: 'Página no encontrada' });
    const { probarPagina } = await import('../services/meta.js');
    return probarPagina(pagina.pageId);
  });

  /** Tipo, vencimiento y permisos del token cargado, sin revelarlo. */
  app.get<{ Params: { id: string } }>('/meta/pages/:id/token', { preHandler: canales }, async (req, reply) => {
    const pagina = await prisma.metaPage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!pagina) return reply.code(404).send({ error: 'Página no encontrada' });
    const { diagnosticarToken } = await import('../services/meta.js');
    return diagnosticarToken(pagina.pageId);
  });

  /** Últimos avisos recibidos: es el diagnóstico de «entró el lead o no». */
  app.get('/meta/leads', { preHandler: canales }, async (req) => {
    const avisos = await prisma.metaLead.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, leadgenId: true, pageId: true, metaFormId: true, campaignId: true,
        platform: true, status: true, error: true, leadId: true, createdAt: true, processedAt: true,
      },
    });
    return { avisos };
  });

  /** Reintento manual de un aviso fallido, sin esperar al backoff. */
  app.post<{ Params: { id: string } }>('/meta/leads/:id/retry', { preHandler: canales }, async (req, reply) => {
    const aviso = await prisma.metaLead.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!aviso) return reply.code(404).send({ error: 'Aviso no encontrado' });
    if (aviso.status === 'procesado') return reply.code(409).send({ error: 'Ese aviso ya entró como lead.' });
    await prisma.metaLead.update({ where: { id: aviso.id }, data: { status: 'recibido', error: null } });
    const { enqueue } = await import('../lib/jobs.js');
    await enqueue('meta.lead.fetch', { leadgenId: aviso.leadgenId });
    return { ok: true };
  });

  // ------------------------------------------------------ whatsapp

  app.get('/whatsapp/numbers', { preHandler: canales }, async (req) => {
    const numeros = await prisma.waNumber.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { project: { select: { id: true, name: true } } },
    });
    return numeros.map(({ accessTokenEnc, ...n }) => ({ ...n, tokenHint: pista(accessTokenEnc) }));
  });

  const numeroWa = z.object({
    phoneNumberId: z.string().regex(/^\d{5,}$/, 'El ID del número son solo dígitos'),
    wabaId: z.string().regex(/^\d{5,}$/, 'El ID de la cuenta son solo dígitos'),
    displayNumber: z.string().min(6),
    accessToken: z.string().transform((v) => v.replace(/\s+/g, '')).pipe(z.string().min(20)),
    projectId: z.string().optional().nullable(),
  });

  app.post('/whatsapp/numbers', { preHandler: canales }, async (req, reply) => {
    const parsed = numeroWa.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const { accessToken, projectId, ...resto } = parsed.data;

    const ocupado = await prisma.waNumber.findUnique({ where: { phoneNumberId: resto.phoneNumberId } });
    if (ocupado) return reply.code(409).send({ error: 'Ese número ya está conectado.' });

    const { suscribirAppAWaba } = await import('../services/whatsapp.js');
    const errorSuscripcion = await suscribirAppAWaba(resto.wabaId, accessToken);
    const numero = await prisma.waNumber.create({
      data: {
        organizationId: req.user!.organizationId,
        ...resto,
        projectId: await proyectoValido(req.user!.organizationId, projectId),
        accessTokenEnc: cifrar(accessToken),
        lastError: errorSuscripcion ? `No se pudo suscribir la app a la cuenta de WhatsApp: ${errorSuscripcion}` : null,
      },
    });
    await audit(req.user!.organizationId, req.user!.id, 'whatsapp.connect', {
      entity: 'wa_number', entityId: numero.id, meta: { phoneNumberId: numero.phoneNumberId }, ip: req.ip,
    });
    const { accessTokenEnc, ...salida } = numero;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.patch<{ Params: { id: string } }>('/whatsapp/numbers/:id', { preHandler: canales }, async (req, reply) => {
    const parsed = numeroWa.partial().omit({ phoneNumberId: true })
      .extend({ active: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const numero = await prisma.waNumber.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!numero) return reply.code(404).send({ error: 'Número no encontrado' });

    const { accessToken, projectId, ...resto } = parsed.data;
    const actualizado = await prisma.waNumber.update({
      where: { id: numero.id },
      data: {
        ...resto,
        ...(projectId !== undefined
          ? { projectId: await proyectoValido(req.user!.organizationId, projectId) }
          : {}),
        ...(accessToken ? { accessTokenEnc: cifrar(accessToken), lastError: null } : {}),
      },
    });
    const { accessTokenEnc, ...salida } = actualizado;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.delete<{ Params: { id: string } }>('/whatsapp/numbers/:id', { preHandler: canales }, async (req, reply) => {
    const numero = await prisma.waNumber.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!numero) return reply.code(404).send({ error: 'Número no encontrado' });
    await prisma.waNumber.delete({ where: { id: numero.id } });
    await audit(req.user!.organizationId, req.user!.id, 'whatsapp.disconnect', {
      entity: 'wa_number', entityId: numero.id, meta: { phoneNumberId: numero.phoneNumberId }, ip: req.ip,
    });
    return { ok: true };
  });

  /**
   * Plantillas aprobadas del cliente. Sin permiso de configuración: son lo único que se puede enviar
   * fuera de la ventana de 24 horas, así que el asesor las necesita para dar seguimiento
   * al día siguiente. No exponen ninguna credencial, solo nombres y textos.
   */
  app.get('/whatsapp/templates', async (req) => {
    const numero = await prisma.waNumber.findFirst({
      where: { organizationId: req.user!.organizationId, active: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!numero) return { ok: false as const, error: 'No hay ningún número conectado' };
    const { plantillasDe } = await import('../services/whatsapp.js');
    return plantillasDe(numero.phoneNumberId);
  });

  app.get<{ Params: { id: string } }>('/whatsapp/numbers/:id/templates', { preHandler: canales }, async (req, reply) => {
    const numero = await prisma.waNumber.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!numero) return reply.code(404).send({ error: 'Número no encontrado' });
    const { plantillasDe } = await import('../services/whatsapp.js');
    return plantillasDe(numero.phoneNumberId);
  });

  /** Un projectId de otra organización dejaría leads colgando de un proyecto ajeno. */
  async function proyectoValido(organizationId: string, projectId?: string | null) {
    if (!projectId) return null;
    const p = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
    return p ? p.id : null;
  }

  // -------------------------------------------------------------- roles
  async function rolPropio(organizationId: string, id: string) {
    return prisma.customRole.findFirst({ where: { id, organizationId } });
  }

  function limpiarPermisos(lista: unknown): Permiso[] | null {
    if (!Array.isArray(lista)) return null;
    const out = [...new Set(lista.filter((x): x is Permiso => typeof x === 'string' && esPermiso(x)))];
    return out.length === lista.length ? out : null;
  }

  /** Catálogo y roles base: lo lee la pantalla de Roles para pintar las casillas. */
  app.get('/roles/catalogo', { preHandler: usuarios }, async () => ({
    permisos: PERMISOS_IDS,
    base: ROLES_BASE,
  }));

  app.get('/roles', { preHandler: veEquipo }, async (req) =>
    prisma.customRole.findMany({
      where: { organizationId: req.user!.organizationId },
      include: { _count: { select: { users: true } } },
      orderBy: { name: 'asc' },
    })
  );

  const rolInput = z.object({
    name: z.string().trim().min(1).max(40),
    permissions: z.array(z.string()).max(PERMISOS_IDS.length),
  });

  app.post('/roles', { preHandler: usuarios }, async (req, reply) => {
    const parsed = rolInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const permisos = limpiarPermisos(parsed.data.permissions);
    if (!permisos) return reply.code(400).send({ error: 'Permiso desconocido' });
    // Un rol del cliente no puede dar más que un gerente: el registro técnico es de Lucuma.
    if (permisos.includes('registro.ver') && req.user!.role !== 'admin_lucuma') {
      return reply.code(403).send({ error: 'Ese permiso solo lo otorga Lucuma' });
    }
    const existe = await prisma.customRole.findFirst({
      where: { organizationId: req.user!.organizationId, name: parsed.data.name },
    });
    if (existe) return reply.code(409).send({ error: 'Ya hay un rol con ese nombre' });
    const rol = await prisma.customRole.create({
      data: { organizationId: req.user!.organizationId, name: parsed.data.name, permissions: permisos },
    });
    await audit(req.user!.organizationId, req.user!.id, 'role.create', { entity: 'role', entityId: rol.id, meta: { name: rol.name, permisos }, ip: req.ip });
    return rol;
  });

  app.patch<{ Params: { id: string } }>('/roles/:id', { preHandler: usuarios }, async (req, reply) => {
    const parsed = rolInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const rol = await rolPropio(req.user!.organizationId, req.params.id);
    if (!rol) return reply.code(404).send({ error: 'Rol no encontrado' });
    let permisos: Permiso[] | undefined;
    if (parsed.data.permissions) {
      const limpios = limpiarPermisos(parsed.data.permissions);
      if (!limpios) return reply.code(400).send({ error: 'Permiso desconocido' });
      if (limpios.includes('registro.ver') && req.user!.role !== 'admin_lucuma') {
        return reply.code(403).send({ error: 'Ese permiso solo lo otorga Lucuma' });
      }
      permisos = limpios;
    }
    const actualizado = await prisma.customRole.update({
      where: { id: rol.id },
      data: { name: parsed.data.name, permissions: permisos },
    });
    // Los permisos aplican a quien ya tiene el rol sin que cierre sesión.
    olvidarPermisos();
    await audit(req.user!.organizationId, req.user!.id, 'role.update', { entity: 'role', entityId: rol.id, meta: { name: actualizado.name, permisos }, ip: req.ip });
    return actualizado;
  });

  /** Borrar un rol exige decir a qué rol base pasan sus usuarios: nadie se queda sin permisos. */
  app.delete<{ Params: { id: string }; Querystring: { pasarA?: string } }>('/roles/:id', { preHandler: usuarios }, async (req, reply) => {
    const rol = await prisma.customRole.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
      include: { _count: { select: { users: true } } },
    });
    if (!rol) return reply.code(404).send({ error: 'Rol no encontrado' });
    const pasarA = req.query.pasarA;
    if (rol._count.users > 0) {
      if (!pasarA || !['gerente', 'asesor', 'solo_lectura'].includes(pasarA)) {
        return reply.code(409).send({ error: `${rol._count.users} usuario(s) tienen este rol: indica a qué rol pasan (pasarA)`, usuarios: rol._count.users });
      }
      await prisma.user.updateMany({ where: { customRoleId: rol.id }, data: { role: pasarA as never, customRoleId: null } });
    }
    await prisma.customRole.delete({ where: { id: rol.id } });
    olvidarPermisos();
    await audit(req.user!.organizationId, req.user!.id, 'role.delete', { entity: 'role', entityId: rol.id, meta: { name: rol.name, pasarA }, ip: req.ip });
    return { ok: true };
  });

  // -------------------------------------------------------- alta manual
  // Alta manual: también es escritura, así que «solo lectura» no pasa de aquí.
  app.post('/leads', { preHandler: requirePermiso('leads.editar') }, async (req, reply) => {
    const parsed = z
      .object({
        fname: z.string().min(1),
        lname: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
        document: z.string().optional(),
        message: z.string().optional(),
        projectId: z.string().optional(),
        typologyIds: z.array(z.string()).optional(),
        unitIds: z.array(z.string()).optional(),
        source: z.string().default('manual'),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const { projectId, typologyIds, unitIds, source, ...values } = parsed.data;
    if (projectId) {
      const proyecto = await prisma.project.findFirst({
        where: { id: projectId, organizationId: req.user!.organizationId },
      });
      if (!proyecto) return reply.code(400).send({ error: 'Proyecto inválido' });
    }
    try {
      await validarIntereses(projectId ?? null, { typologyIds, unitIds });
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
    const result = await captureLead(
      {
        idempotencyKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        values: values as Record<string, string>,
      },
      null,
      { organizationId: req.user!.organizationId, projectId: projectId ?? null, source, ip: req.ip }
    );
    // Se suma y no se reemplaza: si la persona ya tenía un lead abierto en el proyecto,
    // lo marcado en el alta se agrega a lo que ya tenía.
    if (result.leadId && (typologyIds?.length || unitIds?.length)) {
      await sumarIntereses(prisma, result.leadId, { typologyIds, unitIds });
    }
    return result;
  });

  // ---------------------------------------------------------- exportación
  app.get('/leads/export', { preHandler: exportar }, async (req, reply) => {
    const user = req.user!;
    const leads = await prisma.lead.findMany({
      where: { organizationId: user.organizationId },
      include: {
        contact: true,
        project: { select: { name: true } },
        unit: { select: { code: true } },
        stage: { select: { name: true } },
        owner: { select: { name: true } },
        typologyInterests: { select: { typology: { select: { name: true } } } },
        unitInterests: { select: { unit: { select: { code: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // La exportación masiva es el evento crítico de auditoría del rubro.
    await audit(user.organizationId, user.id, 'lead.export', {
      meta: { count: leads.length },
      ip: req.ip,
    });

    const cab = ['fecha', 'nombre', 'apellido', 'telefono', 'email', 'documento', 'proyecto', 'unidad', 'tipologias_interes', 'unidades_interes', 'etapa', 'asesor', 'fuente', 'mensaje'];
    const filas = leads.map((l) => [
      l.createdAt.toISOString(),
      l.contact.fname, l.contact.lname ?? '', l.contact.phone ?? '', l.contact.email ?? '', l.contact.document ?? '',
      l.project?.name ?? '', l.unit?.code ?? '',
      l.typologyInterests.map((t) => t.typology.name).join(' | '),
      l.unitInterests.map((u) => u.unit.code).join(' | '),
      l.stage?.name ?? '', l.owner?.name ?? '', l.source, (l.message ?? '').replace(/\n/g, ' '),
    ]);
    const csv = [cab, ...filas]
      .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    return '﻿' + csv;
  });

  // --------------------------------------------------------- estadísticas
  app.get('/stats', async (req) => {
    const user = req.user!;
    const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [total, mes, porEtapa, sinContactar] = await Promise.all([
      prisma.lead.count({ where: { organizationId: user.organizationId, status: 'activo' } }),
      prisma.lead.count({ where: { organizationId: user.organizationId, createdAt: { gte: desde } } }),
      prisma.lead.groupBy({
        by: ['stageId'],
        where: { organizationId: user.organizationId, status: 'activo' },
        _count: true,
      }),
      prisma.lead.count({
        where: { organizationId: user.organizationId, status: 'activo', firstContactAt: null },
      }),
    ]);
    return { total, ultimos30: mes, porEtapa, sinContactar };
  });
}
