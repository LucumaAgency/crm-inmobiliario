/**
 * Clientes activos y cobranza (vertical agencia). Ver docs/22-VERTICAL-AGENCIA.md.
 *
 * Tres piezas: el cliente, sus servicios contratados y los cobros de cada mes. Los cobros de
 * un servicio mensual (o anual) se generan solos y sin duplicar (`@@unique([servicioId, periodo])`); los
 * de un servicio variable se cargan a mano, y los de una alianza comercial (comision) salen de
 * cada venta registrada: el porcentaje pactado sobre el monto vendido. Nada de esto emite comprobantes: se anota el número
 * de la factura emitida fuera.
 *
 * Las fechas de cobro son fechas de calendario de Lima, sin hora: se guardan como DATE y se
 * construyen a mediodía UTC para que ningún desfase de zona las mueva de día.
 */
import { CUENTA_LUCUMA } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { logError, logLine } from '../lib/log.js';
import { sendMail } from '../lib/mail.js';
export const IGV = 0.18;
export const PERIODICIDADES = ['mensual', 'anual', 'unico', 'variable', 'comision'];
/** Las que generan sus cobros solas. */
export const RECURRENTES = ['mensual', 'anual'];
export const ESTADOS_SERVICIO = ['activo', 'pausado', 'terminado'];
export const ESTADOS_COBRO = ['pendiente', 'pagado', 'anulado'];
/** «2026-10» del día de hoy en Lima. */
export function mesActual(ahora = new Date()) {
    return hoyLima(ahora).slice(0, 7);
}
/** «2026-10-18» en Lima. */
export function hoyLima(ahora = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}
/** Fecha de calendario → Date a mediodía UTC (estable al guardarla como DATE). */
export function fecha(iso) {
    return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}
export function isoDe(d) {
    return d.toISOString().slice(0, 10);
}
export function mesDe(d) {
    return isoDe(d).slice(0, 7);
}
export function sumarMeses(mes, n) {
    const [a, m] = mes.split('-').map(Number);
    const t = a * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
/** Vencimiento del cobro de un mes: el día de pago, sin pasar del último día del mes. */
export function vencimiento(mes, dia) {
    const [a, m] = mes.split('-').map(Number);
    const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
    return fecha(`${mes}-${String(Math.min(Math.max(dia, 1), ultimo)).padStart(2, '0')}`);
}
const r2 = (n) => Math.round(n * 100) / 100;
/** Del monto pactado a base (ingreso) y total (lo que paga el cliente). */
export function importes(amount, igvIncluido) {
    return igvIncluido ? { base: r2(amount / (1 + IGV)), total: r2(amount) } : { base: r2(amount), total: r2(amount * (1 + IGV)) };
}
/**
 * Crea los cobros que falten de los servicios mensuales activos, desde `cobrarDesde` (y el mes
 * de inicio) hasta `hasta`, sin pasar del mes de fin. Idempotente: se puede llamar en cada
 * consulta de la cobranza.
 */
export async function generarCobros(organizationId, hasta) {
    const servicios = await prisma.clienteServicio.findMany({
        where: { organizationId, periodicidad: { in: RECURRENTES }, estado: 'activo', cliente: { active: true } },
    });
    const filas = [];
    for (const s of servicios) {
        const paso = s.periodicidad === 'anual' ? 12 : 1;
        let mes = [s.cobrarDesde, mesDe(s.inicio)].sort().at(-1);
        // Anual: se cobra en el mes aniversario del inicio (el primero desde cobrarDesde).
        if (paso === 12)
            while (mes.slice(5) !== mesDe(s.inicio).slice(5))
                mes = sumarMeses(mes, 1);
        const tope = s.fin && mesDe(s.fin) < hasta ? mesDe(s.fin) : hasta;
        const { base, total } = importes(Number(s.amount), s.igvIncluido);
        const dia = s.diaPago ?? s.inicio.getUTCDate();
        for (let i = 0; mes <= tope && i < 120; i++, mes = sumarMeses(mes, paso)) {
            filas.push({
                organizationId,
                clienteId: s.clienteId,
                servicioId: s.id,
                periodo: mes,
                concepto: s.name,
                base,
                total,
                currency: s.currency,
                vence: vencimiento(mes, dia),
            });
        }
    }
    if (filas.length === 0)
        return 0;
    const r = await prisma.cobro.createMany({ data: filas, skipDuplicates: true });
    return r.count;
}
// ------------------------------------------------------------------ avisos por correo
let ultimaRevision = 0;
/**
 * Un correo de resumen a la cuenta de Lucuma de cada organización agencia: cobros que vencen
 * en 3 días, cobros vencidos y renovaciones a 30 días. Cada cosa se avisa una sola vez (marca
 * en la fila). Corre desde el latido, como mucho una vez por hora y entre las 8 y las 20 de Lima.
 */
export async function avisosCobranza(ahora = new Date()) {
    if (ahora.getTime() - ultimaRevision < 60 * 60 * 1000)
        return;
    const hora = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: '2-digit', hourCycle: 'h23' }).format(ahora));
    if (hora < 8 || hora >= 20)
        return;
    ultimaRevision = ahora.getTime();
    try {
        const orgs = await prisma.organization.findMany({ where: { vertical: 'agencia' }, select: { id: true, name: true, slug: true } });
        for (const org of orgs)
            await avisosDe(org, ahora);
    }
    catch (err) {
        logError('cobranza: no se pudieron revisar los avisos', err);
    }
}
async function avisosDe(org, ahora) {
    const destino = await prisma.user.findFirst({ where: { organizationId: org.id, email: CUENTA_LUCUMA, active: true }, select: { email: true } });
    if (!destino)
        return;
    const hoy = fecha(hoyLima(ahora));
    const en3 = new Date(hoy.getTime() + 3 * 86_400_000);
    const en30 = new Date(hoy.getTime() + 30 * 86_400_000);
    await generarCobros(org.id, mesActual(ahora));
    const incluir = { cliente: { select: { name: true } } };
    const [porVencer, vencidos, renovaciones] = await Promise.all([
        prisma.cobro.findMany({ where: { organizationId: org.id, estado: 'pendiente', vence: { gte: hoy, lte: en3 }, avisoVenceEl: null }, include: incluir, orderBy: { vence: 'asc' } }),
        prisma.cobro.findMany({ where: { organizationId: org.id, estado: 'pendiente', vence: { lt: hoy }, avisoVencidoEl: null }, include: incluir, orderBy: { vence: 'asc' } }),
        prisma.clienteServicio.findMany({ where: { organizationId: org.id, estado: 'activo', fin: { gte: hoy, lte: en30 }, avisoRenovacionEl: null }, include: incluir, orderBy: { fin: 'asc' } }),
    ]);
    if (porVencer.length + vencidos.length + renovaciones.length === 0)
        return;
    const dinero = (n, mon) => `${mon === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const dia = (d) => isoDe(d).split('-').reverse().join('/');
    const lista = (titulo, filas) => filas.length ? `<h3 style="margin:18px 0 6px">${titulo}</h3><ul style="margin:0;padding-left:18px">${filas.map((f) => `<li>${f}</li>`).join('')}</ul>` : '';
    const cobro = (c) => `${c.cliente.name} · ${c.concepto} · ${dinero(c.total, c.currency)} · vence ${dia(c.vence)}`;
    const html = `<p>Resumen de cobranza de ${org.name}.</p>` +
        lista('Vencidos', vencidos.map(cobro)) +
        lista('Vencen en los próximos 3 días', porVencer.map(cobro)) +
        lista('Renovaciones en los próximos 30 días', renovaciones.map((s) => `${s.cliente.name} · ${s.name} · ${dia(s.fin)}`)) +
        `<p style="margin-top:18px;color:#666">Se ve completo en Clientes → Cobranza.</p>`;
    await sendMail({
        to: destino.email,
        subject: `Cobranza: ${[vencidos.length && `${vencidos.length} vencido(s)`, porVencer.length && `${porVencer.length} por vencer`, renovaciones.length && `${renovaciones.length} renovación(es)`].filter(Boolean).join(', ')}`,
        html,
    });
    const marca = new Date();
    await Promise.all([
        porVencer.length && prisma.cobro.updateMany({ where: { id: { in: porVencer.map((c) => c.id) } }, data: { avisoVenceEl: marca } }),
        vencidos.length && prisma.cobro.updateMany({ where: { id: { in: vencidos.map((c) => c.id) } }, data: { avisoVencidoEl: marca } }),
        renovaciones.length && prisma.clienteServicio.updateMany({ where: { id: { in: renovaciones.map((s) => s.id) } }, data: { avisoRenovacionEl: marca } }),
    ]);
    logLine(`cobranza: aviso a ${destino.email} (${vencidos.length} vencidos, ${porVencer.length} por vencer, ${renovaciones.length} renovaciones)`);
}
