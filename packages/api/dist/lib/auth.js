import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { sesionCoincide } from './tenant.js';
import { logError } from './log.js';
import { ROLES_BASE, esPermiso } from '@lucuma-crm/shared';
/** Permisos de un usuario: los del rol personalizado si tiene, si no los del rol base. */
export function permisosDe(user) {
    if (user.customRole) {
        const lista = Array.isArray(user.customRole.permissions) ? user.customRole.permissions : [];
        return {
            permissions: lista.filter((x) => typeof x === 'string' && esPermiso(x)),
            roleName: user.customRole.name,
        };
    }
    const base = ROLES_BASE[user.role] ?? ROLES_BASE.asesor;
    return { permissions: [...base.permisos], roleName: base.nombre };
}
/** Caché corta de permisos por usuario: evita una consulta por petición sin que un cambio de rol tarde más de un minuto. */
const cachePermisos = new Map();
const TTL_PERMISOS_MS = 60 * 1000;
export function olvidarPermisos(userId) {
    if (userId)
        cachePermisos.delete(userId);
    else
        cachePermisos.clear();
}
export function issueSession(reply, user) {
    const { id, organizationId, role, email, name } = user;
    const token = jwt.sign({ id, organizationId, role, email, name }, env.jwtSecret, { expiresIn: '30d' });
    // Sin `domain`: la cookie queda atada al host exacto que la emitió. Poner el dominio
    // padre la compartiría entre todos los subdominios, es decir, entre todos los clientes,
    // que es justamente lo que este modelo evita.
    reply.setCookie(env.cookieName, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: env.isProd,
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
    });
}
export function clearSession(reply) {
    reply.clearCookie(env.cookieName, { path: '/' });
}
/** Carga req.user si hay cookie válida. No corta la petición. */
export async function loadUser(req) {
    const raw = req.cookies?.[env.cookieName];
    if (!raw)
        return;
    try {
        const sesion = jwt.verify(raw, env.jwtSecret);
        /**
         * La sesión solo vale en el subdominio de su organización.
         *
         * Cada cliente vive en un origen distinto, así que el navegador ya no comparte la
         * cookie entre subdominios. Esta comprobación cubre el caso de que alguien la copie
         * a mano: una sesión de Bastión no abre el CRM de Proba.
         */
        if (!sesionCoincide(req, sesion.organizationId))
            return;
        /**
         * Los permisos no viajan en la cookie: se leen de la base en cada petición (con caché
         * de un minuto). Si el gerente cambia el rol de alguien o edita las casillas de un rol,
         * aplica sin que la persona cierre sesión; y un usuario desactivado deja de entrar al
         * instante, no cuando le venza el token a los 30 días.
         */
        const ahora = Date.now();
        let actual = cachePermisos.get(sesion.id);
        if (!actual || actual.expira < ahora) {
            const u = await prisma.user.findUnique({
                where: { id: sesion.id },
                select: { role: true, active: true, customRole: { select: { name: true, permissions: true } } },
            });
            actual = {
                expira: ahora + TTL_PERMISOS_MS,
                valor: u && u.active ? { role: u.role, ...permisosDe(u) } : null,
            };
            cachePermisos.set(sesion.id, actual);
        }
        if (!actual.valor)
            return;
        req.user = { ...sesion, ...actual.valor };
    }
    catch (err) {
        /**
         * Una cookie inválida o vencida se ignora en silencio. Pero si lo que falla es la
         * consulta de permisos (migración sin aplicar, cliente de Prisma sin regenerar), el
         * síntoma es «la página se recarga al entrar y no dice nada»: hay que dejarlo escrito.
         */
        if (!(err instanceof jwt.JsonWebTokenError)) {
            logError('[auth] no se pudieron cargar los permisos de la sesión:', err instanceof Error ? err.message : err);
        }
    }
}
/** Exige sesión. Usar como preHandler. */
export async function requireAuth(req, reply) {
    await loadUser(req);
    if (!req.user)
        return reply.code(401).send({ error: 'No autenticado' });
}
export function requireRole(...roles) {
    return async (req, reply) => {
        await loadUser(req);
        if (!req.user)
            return reply.code(401).send({ error: 'No autenticado' });
        if (!roles.includes(req.user.role))
            return reply.code(403).send({ error: 'Sin permisos' });
    };
}
export function tiene(user, ...permisos) {
    return !!user && permisos.some((p) => user.permissions.includes(p));
}
/** Exige al menos uno de los permisos. Usar como preHandler. */
export function requirePermiso(...permisos) {
    return async (req, reply) => {
        await loadUser(req);
        if (!req.user)
            return reply.code(401).send({ error: 'No autenticado' });
        if (!tiene(req.user, ...permisos))
            return reply.code(403).send({ error: 'Sin permisos' });
    };
}
/**
 * Filtro de visibilidad: quien no puede ver los leads del equipo ve solo los suyos.
 * El aislamiento va en la query, no en la interfaz.
 */
export function scopeForUser(user) {
    const where = { organizationId: user.organizationId };
    if (!user.permissions.includes('leads.ver_todos'))
        where.ownerId = user.id;
    return where;
}
export async function audit(organizationId, userId, action, data = {}) {
    await prisma.auditLog.create({
        data: {
            organizationId,
            userId: userId ?? undefined,
            action,
            entity: data.entity,
            entityId: data.entityId,
            meta: (data.meta ?? undefined),
            ip: data.ip,
        },
    });
}
