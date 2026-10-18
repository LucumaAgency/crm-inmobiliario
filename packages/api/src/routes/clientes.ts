/**
 * Clientes activos y cobranza (vertical agencia). Solo la cuenta de Lucuma, y solo en una
 * organización agencia: en el CRM de una inmobiliaria estas rutas no existen para nadie.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { audit, requireCuentaLucuma } from '../lib/auth.js';
import {
  ESTADOS_COBRO,
  ESTADOS_SERVICIO,
  PERIODICIDADES,
  RECURRENTES,
  fecha,
  generarCobros,
  hoyLima,
  importes,
  isoDe,
  mesActual,
  mesDe,
  sumarMeses,
  vencimiento,
} from '../services/clientes.js';

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const texto = z.string().trim().max(300).nullable().optional();

const datosCliente = z.object({
  name: z.string().trim().min(1).max(191),
  legalName: texto,
  ruc: z.string().trim().regex(/^\d{11}$/, 'El RUC son 11 dígitos').nullable().optional().or(z.literal('').transform(() => null)),
  contactName: texto,
  email: texto,
  phone: texto,
  notes: z.string().max(5000).nullable().optional(),
  active: z.boolean().optional(),
});

const datosServicio = z.object({
  projectId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(191),
  amount: z.number().min(0).max(10_000_000),
  currency: z.enum(['PEN', 'USD']).default('PEN'),
  igvIncluido: z.boolean().default(false),
  periodicidad: z.enum(PERIODICIDADES).default('mensual'),
  comisionPct: z.number().min(0).max(100).nullable().optional(),
  diaPago: z.number().int().min(1).max(31).nullable().optional(),
  inicio: z.string().regex(DIA),
  fin: z.string().regex(DIA).nullable().optional(),
  estado: z.enum(ESTADOS_SERVICIO).default('activo'),
  notes: z.string().max(5000).nullable().optional(),
});

/** Lo que un servicio recurrente aporta al mes, sin IGV: el anual se reparte en 12. */
function alMes(s: { amount: unknown; igvIncluido: boolean; periodicidad: string }) {
  const { base } = importes(Number(s.amount), s.igvIncluido);
  return s.periodicidad === 'anual' ? base / 12 : base;
}

async function soloAgencia(req: FastifyRequest, reply: FastifyReply) {
  const org = await prisma.organization.findUnique({ where: { id: req.user!.organizationId }, select: { vertical: true } });
  if (org?.vertical !== 'agencia') return reply.code(404).send({ error: 'No disponible' });
}

export default async function clientesRoutes(app: FastifyInstance) {
  const pre = [requireCuentaLucuma, soloAgencia];
  const org = (req: FastifyRequest) => req.user!.organizationId;

  async function proyectoValido(organizationId: string, id: string | null | undefined) {
    if (!id) return null;
    const p = await prisma.project.findFirst({ where: { id, organizationId }, select: { id: true } });
    return p?.id ?? null;
  }

  // ------------------------------------------------------------------ clientes
  app.get('/', { preHandler: pre }, async (req) => {
    const hoy = fecha(hoyLima());
    const lista = await prisma.cliente.findMany({
      where: { organizationId: org(req) },
      include: {
        servicios: { orderBy: [{ estado: 'asc' }, { inicio: 'desc' }], include: { project: { select: { id: true, name: true } } } },
        lead: { select: { id: true } },
      },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const vencidos = await prisma.cobro.groupBy({
      by: ['clienteId'],
      where: { organizationId: org(req), estado: 'pendiente', vence: { lt: hoy } },
      _sum: { total: true },
      _count: { _all: true },
    });
    const porCliente = new Map(vencidos.map((v) => [v.clienteId, { n: v._count._all, total: Number(v._sum.total ?? 0) }]));
    return lista.map((c) => ({
      ...c,
      mensual: c.servicios
        .filter((s) => s.estado === 'activo' && RECURRENTES.includes(s.periodicidad))
        .reduce((t, s) => t + alMes(s), 0),
      vencido: porCliente.get(c.id) ?? { n: 0, total: 0 },
    }));
  });

  app.post('/', { preHandler: pre }, async (req, reply) => {
    const p = datosCliente.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const c = await prisma.cliente.create({ data: { ...p.data, organizationId: org(req) } });
    await audit(org(req), req.user!.id, 'cliente.create', { entity: 'cliente', entityId: c.id, meta: { name: c.name } });
    return c;
  });

  app.patch<{ Params: { id: string } }>('/:id', { preHandler: pre }, async (req, reply) => {
    const p = datosCliente.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const r = await prisma.cliente.updateMany({ where: { id: req.params.id, organizationId: org(req) }, data: p.data });
    if (r.count === 0) return reply.code(404).send({ error: 'Cliente no encontrado' });
    await audit(org(req), req.user!.id, 'cliente.update', { entity: 'cliente', entityId: req.params.id, meta: p.data });
    return { ok: true };
  });

  /**
   * Convertir un lead ganado en cliente: datos del contacto y, si tuvo propuesta, un servicio
   * por cada paquete de la última, con el precio ya descontado. Se revisa y ajusta después.
   */
  app.post<{ Params: { leadId: string } }>('/desde-lead/:leadId', { preHandler: pre }, async (req, reply) => {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.leadId, organizationId: org(req) },
      include: { contact: true, proformas: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });
    const ya = await prisma.cliente.findFirst({ where: { leadId: lead.id, organizationId: org(req) }, select: { id: true } });
    if (ya) return reply.code(409).send({ error: 'Este lead ya es cliente', id: ya.id });

    const nombre = [lead.contact.fname, lead.contact.lname].filter(Boolean).join(' ');
    const inicio = hoyLima();
    const prop = lead.proformas[0];
    const items = (prop?.items ?? []) as { code: string; price: number; service?: string; billing?: string | null }[];
    const factor = prop ? 1 - Number(prop.discountPct) / 100 : 1;

    const c = await prisma.cliente.create({
      data: {
        organizationId: org(req),
        leadId: lead.id,
        name: nombre || 'Cliente sin nombre',
        contactName: nombre || null,
        email: lead.contact.email,
        phone: lead.contact.phone,
        servicios: {
          create: items.map((it) => ({
            organizationId: org(req),
            projectId: prop!.projectId,
            name: [it.service, it.code].filter(Boolean).join(' · '),
            amount: Math.round(it.price * factor * 100) / 100,
            currency: prop!.currency,
            periodicidad: /mes/i.test(it.billing ?? '') ? 'mensual' : 'unico',
            inicio: fecha(inicio),
            cobrarDesde: mesDe(fecha(inicio)),
          })),
        },
      },
      include: { servicios: true },
    });
    for (const s of c.servicios.filter((s) => s.periodicidad === 'unico')) await cobroUnico(s);
    await audit(org(req), req.user!.id, 'cliente.create', { entity: 'cliente', entityId: c.id, meta: { name: c.name, desdeLead: lead.id, servicios: c.servicios.length } });
    return c;
  });

  // ------------------------------------------------------------------ servicios
  async function cobroUnico(s: { id: string; organizationId: string; clienteId: string; name: string; amount: unknown; igvIncluido: boolean; currency: string; inicio: Date }) {
    const { base, total } = importes(Number(s.amount), s.igvIncluido);
    await prisma.cobro.createMany({
      data: [{ organizationId: s.organizationId, clienteId: s.clienteId, servicioId: s.id, periodo: mesDe(s.inicio), concepto: s.name, base, total, currency: s.currency, vence: s.inicio }],
      skipDuplicates: true,
    });
  }

  app.post<{ Params: { id: string } }>('/:id/servicios', { preHandler: pre }, async (req, reply) => {
    const p = datosServicio.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    if (p.data.periodicidad === 'comision' && !p.data.comisionPct) return reply.code(400).send({ error: 'Falta el porcentaje de comisión' });
    const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, organizationId: org(req) }, select: { id: true } });
    if (!cliente) return reply.code(404).send({ error: 'Cliente no encontrado' });
    const { inicio, fin, projectId, ...resto } = p.data;
    const s = await prisma.clienteServicio.create({
      data: {
        ...resto,
        organizationId: org(req),
        clienteId: cliente.id,
        projectId: await proyectoValido(org(req), projectId),
        inicio: fecha(inicio),
        fin: fin ? fecha(fin) : null,
        // Un cliente antiguo que se carga hoy no debe aparecer debiendo los meses pasados.
        cobrarDesde: [inicio.slice(0, 7), mesActual()].sort().at(-1)!,
      },
    });
    if (s.periodicidad === 'unico') await cobroUnico(s);
    await generarCobros(org(req), mesActual());
    await audit(org(req), req.user!.id, 'cliente.servicio.create', { entity: 'cliente', entityId: cliente.id, meta: { servicio: s.name, amount: resto.amount, periodicidad: s.periodicidad } });
    return s;
  });

  /**
   * Editar un servicio. Si cambia el monto, se actualizan los cobros pendientes desde este mes;
   * los pasados y los pagados quedan como se cobraron. Si se pausa o termina, se anulan los
   * pendientes de meses futuros.
   */
  app.patch<{ Params: { sid: string } }>('/servicios/:sid', { preHandler: pre }, async (req, reply) => {
    const p = datosServicio.partial().safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const actual = await prisma.clienteServicio.findFirst({ where: { id: req.params.sid, organizationId: org(req) } });
    if (!actual) return reply.code(404).send({ error: 'Servicio no encontrado' });
    const { inicio, fin, projectId, ...resto } = p.data;
    const s = await prisma.clienteServicio.update({
      where: { id: actual.id },
      data: {
        ...resto,
        ...(projectId !== undefined ? { projectId: await proyectoValido(org(req), projectId) } : {}),
        ...(inicio ? { inicio: fecha(inicio) } : {}),
        ...(fin !== undefined ? { fin: fin ? fecha(fin) : null, avisoRenovacionEl: null } : {}),
      },
    });
    const desde = mesActual();
    if (resto.amount !== undefined || resto.igvIncluido !== undefined || resto.name !== undefined || resto.diaPago !== undefined) {
      const { base, total } = importes(Number(s.amount), s.igvIncluido);
      const pendientes = await prisma.cobro.findMany({ where: { servicioId: s.id, estado: 'pendiente', periodo: { gte: desde } } });
      for (const c of pendientes) {
        await prisma.cobro.update({
          where: { id: c.id },
          data: {
            base, total, concepto: s.name, currency: s.currency,
            ...(RECURRENTES.includes(s.periodicidad) ? { vence: vencimiento(c.periodo, s.diaPago ?? s.inicio.getUTCDate()) } : {}),
          },
        });
      }
    }
    if (s.estado !== 'activo') {
      await prisma.cobro.updateMany({ where: { servicioId: s.id, estado: 'pendiente', periodo: { gt: desde } }, data: { estado: 'anulado' } });
    } else {
      await generarCobros(org(req), desde);
    }
    await audit(org(req), req.user!.id, 'cliente.servicio.update', { entity: 'cliente', entityId: s.clienteId, meta: { servicio: s.id, ...p.data } });
    return s;
  });

  // ------------------------------------------------------------------ cobranza
  /**
   * Cobros de un mes y, aparte, los pendientes de meses anteriores (lo que se arrastra).
   * Genera antes los que falten, hasta el mes pedido si es este o el siguiente.
   */
  app.get<{ Querystring: { mes?: string } }>('/cobranza', { preHandler: pre }, async (req) => {
    const actual = mesActual();
    const mes = req.query.mes && MES.test(req.query.mes) ? req.query.mes : actual;
    // Hasta el mes pedido si es el siguiente (para ver lo que viene); nunca meses más lejanos.
    await generarCobros(org(req), mes === sumarMeses(actual, 1) ? mes : actual);
    const incluir = { cliente: { select: { id: true, name: true } }, servicio: { select: { id: true, periodicidad: true } } };
    const [delMes, anteriores] = await Promise.all([
      prisma.cobro.findMany({ where: { organizationId: org(req), periodo: mes }, include: incluir, orderBy: [{ vence: 'asc' }, { concepto: 'asc' }] }),
      prisma.cobro.findMany({ where: { organizationId: org(req), estado: 'pendiente', periodo: { lt: mes } }, include: incluir, orderBy: { vence: 'asc' } }),
    ]);
    const hoy = hoyLima();
    const vivos = delMes.filter((c) => c.estado !== 'anulado');
    const suma = (l: typeof delMes) => l.reduce((t, c) => t + Number(c.total), 0);
    return {
      mes,
      hoy,
      cobros: delMes,
      anteriores,
      totales: {
        esperado: suma(vivos),
        cobrado: suma(vivos.filter((c) => c.estado === 'pagado')),
        pendiente: suma(vivos.filter((c) => c.estado === 'pendiente' && isoDe(c.vence) >= hoy)),
        vencido: suma(vivos.filter((c) => c.estado === 'pendiente' && isoDe(c.vence) < hoy)) + suma(anteriores),
      },
    };
  });

  app.post('/cobros', { preHandler: pre }, async (req, reply) => {
    const p = z
      .object({
        clienteId: z.string(),
        servicioId: z.string().nullable().optional(),
        periodo: z.string().regex(MES),
        concepto: z.string().trim().min(1).max(191),
        amount: z.number().min(0).max(10_000_000),
        igvIncluido: z.boolean().default(false),
        currency: z.enum(['PEN', 'USD']).default('PEN'),
        vence: z.string().regex(DIA),
        notes: z.string().max(5000).nullable().optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const cliente = await prisma.cliente.findFirst({ where: { id: p.data.clienteId, organizationId: org(req) }, select: { id: true } });
    if (!cliente) return reply.code(404).send({ error: 'Cliente no encontrado' });
    let servicioId: string | null = null;
    if (p.data.servicioId) {
      const s = await prisma.clienteServicio.findFirst({ where: { id: p.data.servicioId, clienteId: cliente.id }, select: { id: true, periodicidad: true } });
      // Un recurrente ya tiene su cobro del mes y una comisión puede tener varias ventas al mes:
      // un cobro extra de esos servicios va sin enlazar.
      if (s && (s.periodicidad === 'unico' || s.periodicidad === 'variable')) servicioId = s.id;
    }
    if (servicioId && (await prisma.cobro.findFirst({ where: { servicioId, periodo: p.data.periodo }, select: { id: true } }))) {
      return reply.code(409).send({ error: 'Ese servicio ya tiene un cobro en ese mes. Edítalo.' });
    }
    const { base, total } = importes(p.data.amount, p.data.igvIncluido);
    const c = await prisma.cobro.create({
      data: {
        organizationId: org(req),
        clienteId: cliente.id,
        servicioId,
        periodo: p.data.periodo,
        concepto: p.data.concepto,
        base,
        total,
        currency: p.data.currency,
        vence: fecha(p.data.vence),
        notes: p.data.notes ?? null,
      },
    });
    await audit(org(req), req.user!.id, 'cobro.create', { entity: 'cobro', entityId: c.id, meta: { cliente: cliente.id, total } });
    return c;
  });

  /**
   * Alianza comercial: se registra una venta y nace el cobro de la comisión (porcentaje pactado
   * sobre el monto vendido, más IGV). Sin enlazar al servicio porque puede haber varias ventas
   * en un mes; el concepto lleva el nombre de la alianza.
   */
  app.post<{ Params: { sid: string } }>('/servicios/:sid/ventas', { preHandler: pre }, async (req, reply) => {
    const p = z
      .object({
        detalle: z.string().trim().min(1).max(120),
        monto: z.number().positive().max(100_000_000),
        fecha: z.string().regex(DIA),
        vence: z.string().regex(DIA).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const s = await prisma.clienteServicio.findFirst({ where: { id: req.params.sid, organizationId: org(req), periodicidad: 'comision' } });
    if (!s) return reply.code(404).send({ error: 'Alianza no encontrada' });
    const pct = Number(s.comisionPct ?? 0);
    const { base, total } = importes((p.data.monto * pct) / 100, false);
    const mon = s.currency === 'USD' ? 'US$' : 'S/';
    const c = await prisma.cobro.create({
      data: {
        organizationId: org(req),
        clienteId: s.clienteId,
        periodo: p.data.fecha.slice(0, 7),
        concepto: `${s.name} · ${p.data.detalle}`.slice(0, 191),
        base,
        total,
        currency: s.currency,
        vence: fecha(p.data.vence ?? p.data.fecha),
        notes: `Venta de ${mon} ${p.data.monto.toLocaleString('es-PE', { minimumFractionDigits: 2 })} el ${p.data.fecha} · comisión ${pct} %`,
      },
    });
    await audit(org(req), req.user!.id, 'cobro.create', { entity: 'cobro', entityId: c.id, meta: { cliente: s.clienteId, venta: p.data.monto, pct, total } });
    return c;
  });

  /** Marcar pagado (fecha, medio, comprobante), anular, o corregir monto y vencimiento. */
  app.patch<{ Params: { id: string } }>('/cobros/:id', { preHandler: pre }, async (req, reply) => {
    const p = z
      .object({
        estado: z.enum(ESTADOS_COBRO).optional(),
        pagadoEl: z.string().regex(DIA).nullable().optional(),
        medio: texto,
        comprobante: texto,
        notes: z.string().max(5000).nullable().optional(),
        concepto: z.string().trim().min(1).max(191).optional(),
        amount: z.number().min(0).max(10_000_000).optional(),
        igvIncluido: z.boolean().optional(),
        vence: z.string().regex(DIA).optional(),
      })
      .safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message ?? 'Datos inválidos' });
    const c = await prisma.cobro.findFirst({ where: { id: req.params.id, organizationId: org(req) } });
    if (!c) return reply.code(404).send({ error: 'Cobro no encontrado' });
    const { amount, igvIncluido, pagadoEl, vence, ...resto } = p.data;
    const data: Record<string, unknown> = { ...resto };
    if (amount !== undefined) Object.assign(data, importes(amount, igvIncluido ?? false));
    if (vence) data.vence = fecha(vence);
    if (resto.estado === 'pagado') data.pagadoEl = fecha(pagadoEl ?? hoyLima());
    else if (resto.estado) data.pagadoEl = null;
    else if (pagadoEl !== undefined) data.pagadoEl = pagadoEl ? fecha(pagadoEl) : null;
    const nuevo = await prisma.cobro.update({ where: { id: c.id }, data });
    await audit(org(req), req.user!.id, resto.estado === 'pagado' ? 'cobro.pagado' : 'cobro.update', { entity: 'cobro', entityId: c.id, meta: p.data });
    return nuevo;
  });

  // ------------------------------------------------------------------ ingresos
  /**
   * Últimos 12 meses: facturado (cobros no anulados del mes) y cobrado (pagados), sin IGV, en
   * soles; y el desglose por servicio del catálogo. Los cobros en dólares van aparte.
   */
  app.get('/ingresos', { preHandler: pre }, async (req) => {
    const actual = mesActual();
    const desde = sumarMeses(actual, -11);
    const cobros = await prisma.cobro.findMany({
      where: { organizationId: org(req), estado: { not: 'anulado' }, periodo: { gte: desde, lte: actual } },
      select: { periodo: true, base: true, estado: true, currency: true, concepto: true, servicio: { select: { project: { select: { name: true } } } } },
    });
    const meses = Array.from({ length: 12 }, (_, i) => sumarMeses(desde, i));
    const porMes = meses.map((m) => {
      const del = cobros.filter((c) => c.periodo === m && c.currency === 'PEN');
      return {
        mes: m,
        facturado: del.reduce((t, c) => t + Number(c.base), 0),
        cobrado: del.filter((c) => c.estado === 'pagado').reduce((t, c) => t + Number(c.base), 0),
      };
    });
    const grupos = new Map<string, number>();
    for (const c of cobros.filter((c) => c.currency === 'PEN')) {
      const k = c.servicio?.project?.name ?? 'Otros';
      grupos.set(k, (grupos.get(k) ?? 0) + Number(c.base));
    }
    const servicios = await prisma.clienteServicio.findMany({
      where: { organizationId: org(req), estado: 'activo', periodicidad: { in: RECURRENTES }, cliente: { active: true } },
      select: { amount: true, igvIncluido: true, currency: true, periodicidad: true },
    });
    return {
      meses: porMes,
      porServicio: [...grupos].map(([servicio, total]) => ({ servicio, total })).sort((a, b) => b.total - a.total),
      mensualActual: servicios.filter((s) => s.currency === 'PEN').reduce((t, s) => t + alMes(s), 0),
      enDolares: cobros.filter((c) => c.currency === 'USD').reduce((t, c) => t + Number(c.base), 0),
    };
  });
}
