/**
 * Diagnóstico de solo lectura para revisar una organización sin entrar a ella.
 *
 * Para qué: que Lucuma (o Claude, en una sesión de soporte) vea el estado real de la base
 * en producción —cuántos leads por etapa, qué inventario hay, si la migración cuadra con
 * Sperant— sin que el cliente copie pantallas. Se diseñó para poder pasar la llave por un
 * chat sin exponer a nadie:
 *
 * - La genera un administrador (`usuarios.gestionar`) y vence sola a las 24 h; se revoca antes.
 * - En la base solo queda su hash. El texto se muestra una vez.
 * - La respuesta es **agregada**: cifras, códigos de unidad e identificadores internos. Nunca
 *   nombres, teléfonos, correos ni documentos de clientes (Ley 29733). De los usuarios del
 *   equipo sí va nombre y correo: son cuentas de trabajo y hace falta ver a quién se asignó.
 * - Solo lectura: ninguna ruta con la llave escribe nada salvo la auditoría.
 * - Cada consulta queda en auditoría.
 *
 * Formato de la llave: `diag_<slug>_<secreto>` (el slug dice de qué organización es).
 */
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { audit, requireAuth, requirePermiso } from '../lib/auth.js';
import { guardarAjustes, leerAjustes } from '../lib/ajustes.js';
import { compararConCrm, leerEstado } from '../services/sperant.js';
import { driveConfigurado } from '../lib/drive.js';
import { leerEstadoRespaldo } from '../services/respaldos.js';

const VIGENCIA_MS = 24 * 60 * 60 * 1000;

interface Llave {
  id: string;
  hash: string;
  creadaEl: string;
  venceEl: string;
  creadaPor: string;
  revocadaEl?: string | null;
}

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

async function llavesDe(organizationId: string): Promise<Llave[]> {
  return ((await leerAjustes(organizationId)) as unknown as { diagnostico?: Llave[] }).diagnostico ?? [];
}

export default async function diagnosticoRoutes(app: FastifyInstance) {
  const gestiona = [requireAuth, requirePermiso('usuarios.gestionar')];

  app.get('/llaves', { preHandler: gestiona }, async (req) => {
    const ahora = Date.now();
    return (await llavesDe(req.user!.organizationId)).map(({ hash: _h, ...l }) => ({
      ...l,
      vigente: !l.revocadaEl && new Date(l.venceEl).getTime() > ahora,
    }));
  });

  app.post('/llaves', { preHandler: gestiona }, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: req.user!.organizationId },
      select: { id: true, slug: true },
    });
    const llave = `diag_${org.slug}_${crypto.randomBytes(24).toString('base64url')}`;
    const ahora = new Date();
    const nueva: Llave = {
      id: crypto.randomUUID(),
      hash: sha(llave),
      creadaEl: ahora.toISOString(),
      venceEl: new Date(ahora.getTime() + VIGENCIA_MS).toISOString(),
      creadaPor: req.user!.email,
    };
    // Se guardan solo las del último mes: lo demás ya está en audit_log.
    const previas = (await llavesDe(org.id)).filter((l) => Date.now() - new Date(l.creadaEl).getTime() < 30 * 24 * 3600 * 1000);
    await guardarAjustes(org.id, { diagnostico: [...previas, nueva] } as never);
    await audit(org.id, req.user!.id, 'diagnostico.llave', { meta: { id: nueva.id, venceEl: nueva.venceEl } });
    return { id: nueva.id, llave, venceEl: nueva.venceEl };
  });

  app.delete<{ Params: { id: string } }>('/llaves/:id', { preHandler: gestiona }, async (req, reply) => {
    const llaves = await llavesDe(req.user!.organizationId);
    const l = llaves.find((x) => x.id === req.params.id);
    if (!l) return reply.code(404).send({ error: 'Llave no encontrada' });
    l.revocadaEl = new Date().toISOString();
    await guardarAjustes(req.user!.organizationId, { diagnostico: llaves } as never);
    await audit(req.user!.organizationId, req.user!.id, 'diagnostico.revocar', { meta: { id: l.id } });
    return { ok: true };
  });

  /** La consulta. Sin cookie: `Authorization: Bearer diag_<slug>_<secreto>`. */
  app.get('/', async (req, reply) => {
    const llave = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    const m = /^diag_([a-z0-9-]+)_([A-Za-z0-9_-]{20,})$/.exec(llave);
    const negar = () => reply.code(401).send({ error: 'Llave inválida, vencida o revocada' });
    if (!m) return negar();
    const org = await prisma.organization.findUnique({ where: { slug: m[1] } });
    if (!org) return negar();
    const h = Buffer.from(sha(llave));
    const valida = (await llavesDe(org.id)).find((l) => {
      const b = Buffer.from(l.hash);
      return b.length === h.length && crypto.timingSafeEqual(b, h) && !l.revocadaEl && new Date(l.venceEl).getTime() > Date.now();
    });
    if (!valida) return negar();
    await audit(org.id, null, 'diagnostico.consulta', { ip: req.ip, meta: { llave: valida.id } });

    const o = org.id;
    const deSperant: Prisma.LeadWhereInput = { attribution: { path: '$.sperant', not: Prisma.AnyNull } };
    const agrupar = async (by: 'status' | 'stageId' | 'ownerId' | 'source' | 'projectId', where: Prisma.LeadWhereInput = {}) =>
      (await prisma.lead.groupBy({ by: [by], where: { organizationId: o, ...where }, _count: { _all: true } })).map((g) => ({
        valor: (g as Record<string, unknown>)[by] as string | null,
        n: g._count._all,
      }));

    const [usuarios, etapas, proyectos, tipologias, unidades, total, deSp] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId: o },
        select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true, passwordHash: true, customRole: { select: { name: true } } },
      }),
      prisma.stage.findMany({ where: { organizationId: o }, orderBy: { position: 'asc' }, select: { id: true, name: true, position: true, isLost: true, isWon: true } }),
      prisma.project.findMany({ where: { organizationId: o }, select: { id: true, name: true, code: true, address: true, district: true, legalName: true, ruc: true, logoUrl: true, active: true } }),
      prisma.typology.findMany({
        where: { project: { organizationId: o } },
        select: { id: true, projectId: true, name: true, bedrooms: true, bathrooms: true, areaM2: true, priceFrom: true, currency: true, imageUrl: true, planUrl: true, active: true, _count: { select: { units: true, intereses: true } } },
      }),
      prisma.unit.findMany({
        where: { project: { organizationId: o } },
        orderBy: { code: 'asc' },
        select: { id: true, projectId: true, code: true, kind: true, status: true, price: true, currency: true, areaM2: true, floor: true, bedrooms: true, bathrooms: true, typologyRef: { select: { name: true } }, extra: true },
      }),
      prisma.lead.count({ where: { organizationId: o } }),
      prisma.lead.count({ where: { organizationId: o, ...deSperant } }),
    ]);
    const nombreEtapa = new Map(etapas.map((e) => [e.id, e.name]));
    const correoUsuario = new Map(usuarios.map((u) => [u.id, u.email]));
    const nombreProyecto = new Map(proyectos.map((p) => [p.id, p.name]));
    const etiquetar = (filas: { valor: string | null; n: number }[], mapa?: Map<string, string>) =>
      filas.map((f) => ({ valor: f.valor ? mapa?.get(f.valor) ?? f.valor : null, n: f.n })).sort((a, b) => b.n - a.n);
    const archivo = (url: string | null) => (url ? (/^https?:/i.test(url) ? `externa (${new URL(url).host})` : 'local') : null);

    const [porEstado, porEtapa, porAsesor, porFuente, porProyecto, spPorEtapa, spPorAsesor] = await Promise.all([
      agrupar('status'),
      agrupar('stageId'),
      agrupar('ownerId'),
      agrupar('source'),
      agrupar('projectId'),
      agrupar('stageId', deSperant),
      agrupar('ownerId', deSperant),
    ]);
    const [sinEtapa, sinAsesor, activosSinPrimerContacto, spSinEtapa, spSinFicha, contactos, proformas, conversaciones, notasProforma] = await Promise.all([
      prisma.lead.count({ where: { organizationId: o, stageId: null } }),
      prisma.lead.count({ where: { organizationId: o, ownerId: null } }),
      prisma.lead.count({ where: { organizationId: o, firstContactAt: null, status: 'activo' } }),
      prisma.lead.count({ where: { organizationId: o, AND: [deSperant, { attribution: { path: '$.sperant.etapa', equals: Prisma.AnyNull } }] } }),
      prisma.lead.count({ where: { organizationId: o, AND: [deSperant, { attribution: { path: '$.sperant.cliente', equals: Prisma.AnyNull } }] } }),
      prisma.contact.count({ where: { organizationId: o } }),
      prisma.proforma.count({ where: { organizationId: o } }),
      prisma.waConversation.count({ where: { organizationId: o } }),
      prisma.activity.count({ where: { lead: { organizationId: o }, type: 'nota', meta: { path: '$.sperant_budget_id', not: Prisma.AnyNull } } }),
    ]);
    const porMes = await prisma.$queryRaw<{ mes: string; n: bigint }[]>`
      SELECT DATE_FORMAT(createdAt, '%Y-%m') AS mes, COUNT(*) AS n FROM leads WHERE organizationId = ${o} GROUP BY mes ORDER BY mes`;
    // Qué se hizo últimamente (sin `meta`, que puede llevar datos): acciones, entidad, quién.
    const auditoria = await prisma.auditLog.findMany({
      where: { organizationId: o, NOT: { action: { in: ['lead.view', 'user.login', 'diagnostico.consulta'] } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { action: true, entity: true, createdAt: true, user: { select: { email: true } } },
    });
    const est = leerEstado(o);

    // WhatsApp: qué números tiene ESTA organización y qué tipos de mensaje llegan. De los
    // «no soportados» va el tipo original y el código de Meta, nunca el contenido.
    const [numeros, tiposMensaje, raros] = await Promise.all([
      prisma.waNumber.findMany({ where: { organizationId: o }, select: { id: true, displayNumber: true, phoneNumberId: true, active: true, projectId: true, createdAt: true } }),
      prisma.waMessage.groupBy({ by: ['direction', 'type'], where: { conversation: { organizationId: o } }, _count: { _all: true } }),
      prisma.waMessage.findMany({
        where: { conversation: { organizationId: o }, type: 'unsupported' },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, createdAt: true, body: true, raw: true, conversation: { select: { waNumber: { select: { displayNumber: true } } } } },
      }),
    ]);

    return {
      generadoEl: new Date().toISOString(),
      organizacion: { slug: org.slug, nombre: org.name, vertical: (org as { vertical?: string }).vertical ?? null },
      usuarios: usuarios.map(({ passwordHash, customRole, ...u }) => ({ ...u, rolPropio: customRole?.name ?? null, tienePassword: !!passwordHash })),
      etapas,
      proyectos: proyectos.map((p) => ({ ...p, logoUrl: archivo(p.logoUrl) })),
      tipologias: tipologias.map(({ _count, imageUrl, planUrl, ...t }) => ({
        ...t,
        proyecto: nombreProyecto.get(t.projectId),
        unidades: _count.units,
        interesados: _count.intereses,
        imagen: archivo(imageUrl),
        plano: archivo(planUrl),
      })),
      unidades: unidades.map(({ extra, typologyRef, ...u }) => {
        const sp = (extra ?? {}) as { sperant_unit_id?: unknown; sperant?: { vista?: unknown; pertenece_a?: unknown } };
        return {
          ...u,
          proyecto: nombreProyecto.get(u.projectId),
          tipologia: typologyRef?.name ?? null,
          sperantUnitId: sp.sperant_unit_id ?? null,
          vista: sp.sperant?.vista ?? null,
          perteneceA: sp.sperant?.pertenece_a ?? null,
        };
      }),
      leads: {
        total,
        deSperant: deSp,
        creadosEnCrm: total - deSp,
        contactos,
        porEstado: etiquetar(porEstado),
        porEtapa: etiquetar(porEtapa, nombreEtapa),
        porAsesor: etiquetar(porAsesor, correoUsuario),
        porFuente: etiquetar(porFuente),
        porProyecto: etiquetar(porProyecto, nombreProyecto),
        deSperantPorEtapa: etiquetar(spPorEtapa, nombreEtapa),
        deSperantPorAsesor: etiquetar(spPorAsesor, correoUsuario),
        sinEtapa,
        sinAsesor,
        activosSinPrimerContacto,
        deSperantSinEtapaGuardada: spSinEtapa,
        deSperantSinFichaCompleta: spSinFicha,
        porMes: porMes.map((r) => ({ mes: r.mes, n: Number(r.n) })),
      },
      proformasCrm: proformas,
      notasDeProformaSperant: notasProforma,
      conversacionesWhatsApp: conversaciones,
      // Estado del respaldo diario: fechas, nombre del ZIP y si llegó a Drive. Sin datos de clientes.
      respaldos: { driveConfigurado: driveConfigurado(), ...(await leerEstadoRespaldo(org.id)) },
      whatsapp: {
        numeros: numeros.map((n) => ({ ...n, proyecto: n.projectId ? nombreProyecto.get(n.projectId) ?? null : null })),
        mensajesPorTipo: tiposMensaje.map((t) => ({ direccion: t.direction, tipo: t.type, n: t._count._all })),
        noSoportadosRecientes: raros.map((m) => {
          const raw = (m.raw ?? {}) as { type?: string; errors?: { code?: number; title?: string; error_data?: { details?: string } }[] };
          return {
            id: m.id,
            el: m.createdAt,
            numero: m.conversation.waNumber?.displayNumber ?? null,
            tipoOriginal: raw.type ?? null,
            codigoMeta: raw.errors?.[0]?.code ?? null,
            motivoMeta: raw.errors?.[0]?.error_data?.details ?? raw.errors?.[0]?.title ?? null,
            tieneTexto: !!m.body,
          };
        }),
      },
      sperant: {
        fase: est.fase,
        mapaProyectos: est.mapaProyectos ?? null,
        ultimaImportacion: est.importe ? { fin: est.importe.fin, leads: est.importe.leads, proyectos: est.importe.proyectos ?? null } : null,
        comparacion: await compararConCrm(o),
      },
      auditoriaReciente: auditoria.map((a) => ({ accion: a.action, entidad: a.entity, el: a.createdAt, por: a.user?.email ?? null })),
    };
  });
}
