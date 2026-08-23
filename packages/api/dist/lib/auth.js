import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { prisma } from '../db.js';
import { sesionCoincide } from './tenant.js';
export function issueSession(reply, user) {
    const token = jwt.sign(user, env.jwtSecret, { expiresIn: '30d' });
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
        req.user = sesion;
    }
    catch {
        /* cookie inválida o vencida: se ignora */
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
/**
 * Filtro de visibilidad: el asesor ve solo sus leads, el resto ve los de su organización.
 * El aislamiento va en la query, no en la interfaz.
 */
export function scopeForUser(user) {
    const where = { organizationId: user.organizationId };
    if (user.role === 'asesor')
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
