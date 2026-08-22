import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { prisma } from '../db.js';
export function issueSession(reply, user) {
    const token = jwt.sign(user, env.jwtSecret, { expiresIn: '30d' });
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
        req.user = jwt.verify(raw, env.jwtSecret);
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
