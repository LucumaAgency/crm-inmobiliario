import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formSchema } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { borrarSiHuerfano, guardar, urlPublica } from '../lib/media.js';
import { audit, requireAuth, requireRole } from '../lib/auth.js';
import { generatePublicKey, generateSecretKey, hashKey } from '../lib/keys.js';
import { captureLead } from '../services/capture.js';
import { cifrar, pista } from '../lib/secretos.js';

/** Gestión: proyectos, unidades, formularios, sitios, usuarios, etapas. */
export default async function adminRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);
  const gestion = requireRole('admin_lucuma', 'gerente');

  // ------------------------------------------------------------- etapas
  app.get('/stages', async (req) =>
    prisma.stage.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { position: 'asc' },
    })
  );

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

  app.post('/projects', { preHandler: gestion }, async (req, reply) => {
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

  app.post<{ Params: { id: string } }>('/projects/:id/typologies', { preHandler: gestion }, async (req, reply) => {
    const parsed = typologyInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!project) return reply.code(404).send({ error: 'Proyecto no encontrado' });
    return prisma.typology.create({ data: { ...parsed.data, projectId: project.id } });
  });

  app.patch<{ Params: { id: string } }>('/typologies/:id', { preHandler: gestion }, async (req, reply) => {
    const parsed = typologyInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const tip = await prisma.typology.findFirst({
      where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
    });
    if (!tip) return reply.code(404).send({ error: 'Tipología no encontrada' });
    return prisma.typology.update({ where: { id: tip.id }, data: parsed.data });
  });

  /**
   * Borrar una tipología.
   *
   * Las unidades no se tocan: la relación es `SetNull`, así que quedan sin tipología en vez
   * de desaparecer del inventario. Se avisa cuántas quedan sueltas para que quien borra lo
   * sepa antes de irse.
   */
  app.delete<{ Params: { id: string } }>('/typologies/:id', { preHandler: gestion }, async (req, reply) => {
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
    { preHandler: gestion },
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

  app.post<{ Params: { id: string } }>('/projects/:id/units', { preHandler: gestion }, async (req, reply) => {
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
  app.post<{ Params: { id: string } }>('/projects/:id/units/import', { preHandler: gestion }, async (req, reply) => {
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

  app.patch<{ Params: { id: string } }>('/units/:id', { preHandler: gestion }, async (req, reply) => {
    const parsed = unitInput.partial().safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const unit = await prisma.unit.findFirst({
      where: { id: req.params.id, project: { organizationId: req.user!.organizationId } },
    });
    if (!unit) return reply.code(404).send({ error: 'Unidad no encontrada' });
    const { typologyId, ...resto } = parsed.data;
    return prisma.unit.update({
      where: { id: unit.id },
      data: { ...resto, ...(typologyId === undefined ? {} : { typologyId: typologyId || null }) },
    });
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

  app.post('/forms', { preHandler: gestion }, async (req, reply) => {
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
  app.put<{ Params: { id: string } }>('/forms/:id', { preHandler: gestion }, async (req, reply) => {
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
  app.get('/sites', { preHandler: gestion }, async (req) => {
    const sites = await prisma.site.findMany({
      where: { organizationId: req.user!.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    // La secret key no se devuelve nunca: solo se ve una vez, al generarla.
    return sites.map(({ secretKeyHash, ...s }) => s);
  });

  app.post('/sites', { preHandler: gestion }, async (req, reply) => {
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

  app.post<{ Params: { id: string } }>('/sites/:id/rotate', { preHandler: gestion }, async (req, reply) => {
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
  app.get('/users', { preHandler: gestion }, async (req) =>
    prisma.user.findMany({
      where: { organizationId: req.user!.organizationId },
      select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true },
      orderBy: { name: 'asc' },
    })
  );

  app.post('/users', { preHandler: gestion }, async (req, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).default('asesor'),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    return prisma.user.create({
      data: {
        ...parsed.data,
        email: parsed.data.email.toLowerCase(),
        organizationId: req.user!.organizationId,
      },
      select: { id: true, name: true, email: true, role: true, active: true },
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
  app.patch<{ Params: { id: string } }>('/users/:id', { preHandler: gestion }, async (req, reply) => {
    const parsed = z
      .object({
        active: z.boolean().optional(),
        role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

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

    return prisma.user.update({
      where: { id: objetivo.id },
      data: parsed.data,
      select: { id: true, name: true, email: true, role: true, active: true },
    });
  });

  // --------------------------------------------------- meta lead ads
  /**
   * Páginas de Facebook conectadas. El page access token no vuelve nunca al navegador:
   * se muestra solo una pista de sus últimos caracteres, para saber cuál está cargado.
   */
  app.get('/meta/pages', { preHandler: gestion }, async (req) => {
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
    accessToken: z.string().min(20),
    projectId: z.string().optional().nullable(),
    formMap: z.record(z.string()).optional(),
    notifyEmails: z.array(z.string().email()).optional(),
  });

  app.post('/meta/pages', { preHandler: gestion }, async (req, reply) => {
    const parsed = paginaMeta.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const { accessToken, projectId, ...resto } = parsed.data;

    // El pageId es único en toda la instalación: si ya existe, o es un duplicado del
    // mismo cliente o alguien está intentando desviar los leads de otro. No se dice cuál.
    const ocupada = await prisma.metaPage.findUnique({ where: { pageId: resto.pageId } });
    if (ocupada) return reply.code(409).send({ error: 'Esa página ya está conectada.' });

    const pagina = await prisma.metaPage.create({
      data: {
        organizationId: req.user!.organizationId,
        ...resto,
        projectId: await proyectoValido(req.user!.organizationId, projectId),
        accessTokenEnc: cifrar(accessToken),
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

  app.patch<{ Params: { id: string } }>('/meta/pages/:id', { preHandler: gestion }, async (req, reply) => {
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
        ...(accessToken ? { accessTokenEnc: cifrar(accessToken), lastError: null } : {}),
      },
    });
    const { accessTokenEnc, ...salida } = actualizada;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.delete<{ Params: { id: string } }>('/meta/pages/:id', { preHandler: gestion }, async (req, reply) => {
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
  app.get<{ Params: { id: string } }>('/meta/pages/:id/test', { preHandler: gestion }, async (req, reply) => {
    const pagina = await prisma.metaPage.findFirst({
      where: { id: req.params.id, organizationId: req.user!.organizationId },
    });
    if (!pagina) return reply.code(404).send({ error: 'Página no encontrada' });
    const { probarPagina } = await import('../services/meta.js');
    return probarPagina(pagina.pageId);
  });

  /** Últimos avisos recibidos: es el diagnóstico de «entró el lead o no». */
  app.get('/meta/leads', { preHandler: gestion }, async (req) => {
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
  app.post<{ Params: { id: string } }>('/meta/leads/:id/retry', { preHandler: gestion }, async (req, reply) => {
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

  app.get('/whatsapp/numbers', { preHandler: gestion }, async (req) => {
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
    accessToken: z.string().min(20),
    projectId: z.string().optional().nullable(),
  });

  app.post('/whatsapp/numbers', { preHandler: gestion }, async (req, reply) => {
    const parsed = numeroWa.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const { accessToken, projectId, ...resto } = parsed.data;

    const ocupado = await prisma.waNumber.findUnique({ where: { phoneNumberId: resto.phoneNumberId } });
    if (ocupado) return reply.code(409).send({ error: 'Ese número ya está conectado.' });

    const numero = await prisma.waNumber.create({
      data: {
        organizationId: req.user!.organizationId,
        ...resto,
        projectId: await proyectoValido(req.user!.organizationId, projectId),
        accessTokenEnc: cifrar(accessToken),
      },
    });
    await audit(req.user!.organizationId, req.user!.id, 'whatsapp.connect', {
      entity: 'wa_number', entityId: numero.id, meta: { phoneNumberId: numero.phoneNumberId }, ip: req.ip,
    });
    const { accessTokenEnc, ...salida } = numero;
    return { ...salida, tokenHint: pista(accessTokenEnc) };
  });

  app.patch<{ Params: { id: string } }>('/whatsapp/numbers/:id', { preHandler: gestion }, async (req, reply) => {
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

  app.delete<{ Params: { id: string } }>('/whatsapp/numbers/:id', { preHandler: gestion }, async (req, reply) => {
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
   * Plantillas aprobadas del cliente. Sin `gestion`: son lo único que se puede enviar
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

  app.get<{ Params: { id: string } }>('/whatsapp/numbers/:id/templates', { preHandler: gestion }, async (req, reply) => {
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

  // -------------------------------------------------------- alta manual
  app.post('/leads', async (req, reply) => {
    const parsed = z
      .object({
        fname: z.string().min(1),
        lname: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        phone: z.string().optional(),
        document: z.string().optional(),
        message: z.string().optional(),
        projectId: z.string().optional(),
        source: z.string().default('manual'),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const { projectId, source, ...values } = parsed.data;
    const result = await captureLead(
      {
        idempotencyKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        values: values as Record<string, string>,
      },
      null,
      { organizationId: req.user!.organizationId, projectId: projectId ?? null, source, ip: req.ip }
    );
    return result;
  });

  // ---------------------------------------------------------- exportación
  app.get('/leads/export', { preHandler: gestion }, async (req, reply) => {
    const user = req.user!;
    const leads = await prisma.lead.findMany({
      where: { organizationId: user.organizationId },
      include: {
        contact: true,
        project: { select: { name: true } },
        unit: { select: { code: true } },
        stage: { select: { name: true } },
        owner: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // La exportación masiva es el evento crítico de auditoría del rubro.
    await audit(user.organizationId, user.id, 'lead.export', {
      meta: { count: leads.length },
      ip: req.ip,
    });

    const cab = ['fecha', 'nombre', 'apellido', 'telefono', 'email', 'documento', 'proyecto', 'unidad', 'etapa', 'asesor', 'fuente', 'mensaje'];
    const filas = leads.map((l) => [
      l.createdAt.toISOString(),
      l.contact.fname, l.contact.lname ?? '', l.contact.phone ?? '', l.contact.email ?? '', l.contact.document ?? '',
      l.project?.name ?? '', l.unit?.code ?? '', l.stage?.name ?? '', l.owner?.name ?? '', l.source, (l.message ?? '').replace(/\n/g, ' '),
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
