import { prisma } from '../db.js';
import { requireAuth, scopeForUser } from '../lib/auth.js';
/** Lima no tiene horario de verano: el día comercial es UTC-5 todo el año. */
const OFFSET_LIMA_MS = -5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;
function diaLima(fecha) {
    return new Date(fecha.getTime() + OFFSET_LIMA_MS).toISOString().slice(0, 10);
}
function mediana(valores) {
    if (valores.length === 0)
        return null;
    const orden = [...valores].sort((a, b) => a - b);
    const medio = Math.floor(orden.length / 2);
    return orden.length % 2 ? orden[medio] : (orden[medio - 1] + orden[medio]) / 2;
}
/** Indicadores de un período. Mismo cálculo para el actual y el anterior, o no serían comparables. */
function indicadores(leads, ganadas) {
    const contactados = leads.filter((l) => l.firstContactAt);
    const minutos = contactados.map((l) => (l.firstContactAt.getTime() - l.createdAt.getTime()) / 60000);
    return {
        leads: leads.length,
        contactados: contactados.length,
        tasaContacto: leads.length ? contactados.length / leads.length : null,
        medianaPrimerContactoMin: mediana(minutos),
        ganados: leads.filter((l) => l.stageId && ganadas.has(l.stageId)).length,
    };
}
/**
 * Resumen y reportes. Todo sale de UNA consulta de los leads de los dos períodos y se agrega
 * aquí: con el volumen de una inmobiliaria (cientos al mes) es más simple y más barato que
 * una consulta agrupada por cada tarjeta.
 *
 * Respeta la visibilidad del rol: el asesor ve sus números, no los del equipo.
 */
export default async function reportesRoutes(app) {
    app.addHook('preHandler', requireAuth);
    app.get('/resumen', async (req) => {
        const user = req.user;
        const dias = Math.min(Math.max(Number(req.query.dias) || 30, 7), 365);
        // Períodos alineados a días de Lima: [inicio, hoy] y los `dias` anteriores.
        const hoy = diaLima(new Date());
        const inicio = new Date(Date.parse(hoy) - (dias - 1) * DIA_MS - OFFSET_LIMA_MS);
        const inicioPrev = new Date(inicio.getTime() - dias * DIA_MS);
        const alcance = {
            ...scopeForUser(user),
            ...(req.query.proyecto ? { projectId: req.query.proyecto } : {}),
        };
        const [filas, etapas, proyectos, sinContactar] = await Promise.all([
            prisma.lead.findMany({
                where: { ...alcance, createdAt: { gte: inicioPrev } },
                select: {
                    createdAt: true,
                    firstContactAt: true,
                    source: true,
                    stageId: true,
                    projectId: true,
                    status: true,
                },
            }),
            prisma.stage.findMany({
                where: { organizationId: user.organizationId },
                orderBy: { position: 'asc' },
                select: { id: true, name: true, color: true, isWon: true, isLost: true },
            }),
            prisma.project.findMany({
                where: { organizationId: user.organizationId },
                select: { id: true, name: true },
            }),
            // Estado de hoy, no del período: lo que el equipo tiene pendiente ahora mismo.
            prisma.lead.count({ where: { ...alcance, status: 'activo', firstContactAt: null } }),
        ]);
        const ganadas = new Set(etapas.filter((e) => e.isWon).map((e) => e.id));
        const actual = filas.filter((f) => f.createdAt >= inicio);
        const previo = filas.filter((f) => f.createdAt < inicio);
        // Serie diaria con el día equivalente del período anterior al lado.
        const porDia = new Map();
        for (const f of filas) {
            const d = diaLima(f.createdAt);
            const v = porDia.get(d) ?? { leads: 0, contactados: 0, ganados: 0 };
            v.leads++;
            if (f.firstContactAt)
                v.contactados++;
            if (f.stageId && ganadas.has(f.stageId))
                v.ganados++;
            porDia.set(d, v);
        }
        const serie = Array.from({ length: dias }, (_, i) => {
            const fecha = new Date(Date.parse(hoy) - (dias - 1 - i) * DIA_MS).toISOString().slice(0, 10);
            const fechaPrev = new Date(Date.parse(fecha) - dias * DIA_MS).toISOString().slice(0, 10);
            const v = porDia.get(fecha);
            const p = porDia.get(fechaPrev);
            return {
                fecha,
                leads: v?.leads ?? 0,
                contactados: v?.contactados ?? 0,
                ganados: v?.ganados ?? 0,
                leadsPrev: p?.leads ?? 0,
                contactadosPrev: p?.contactados ?? 0,
                ganadosPrev: p?.ganados ?? 0,
            };
        });
        const contar = (lista, clave) => {
            const m = new Map();
            for (const f of lista) {
                const k = f[clave] ?? '';
                m.set(k, (m.get(k) ?? 0) + 1);
            }
            return m;
        };
        const fuentes = contar(actual, 'source');
        const fuentesPrev = contar(previo, 'source');
        const porFuente = [...new Set([...fuentes.keys(), ...fuentesPrev.keys()])]
            .map((source) => ({ source, n: fuentes.get(source) ?? 0, nPrev: fuentesPrev.get(source) ?? 0 }))
            .sort((a, b) => b.n - a.n);
        // El embudo es el estado actual de los leads del período, no de toda la historia.
        const enEtapa = contar(actual, 'stageId');
        const porEtapa = etapas.map((e) => ({
            id: e.id,
            name: e.name,
            color: e.color,
            isWon: e.isWon,
            isLost: e.isLost,
            n: enEtapa.get(e.id) ?? 0,
        }));
        const nombres = new Map(proyectos.map((p) => [p.id, p.name]));
        const enProyecto = contar(actual, 'projectId');
        const porProyecto = [...enProyecto.entries()]
            .map(([id, n]) => ({ id: id || null, name: nombres.get(id) ?? 'Sin proyecto', n }))
            .sort((a, b) => b.n - a.n);
        return {
            dias,
            desde: diaLima(inicio),
            hasta: hoy,
            actual: indicadores(actual, ganadas),
            previo: indicadores(previo, ganadas),
            sinContactar,
            serie,
            porFuente,
            porEtapa,
            porProyecto,
        };
    });
}
