import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env.js';
import { prisma } from '../db.js';

export interface SessionUser {
  id: string;
  organizationId: string;
  role: 'admin_lucuma' | 'gerente' | 'asesor' | 'solo_lectura';
  email: string;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

export function issueSession(reply: FastifyReply, user: SessionUser) {
  const token = jwt.sign(user, env.jwtSecret, { expiresIn: '30d' });
  reply.setCookie(env.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(env.cookieName, { path: '/' });
}

/** Carga req.user si hay cookie válida. No corta la petición. */
export async function loadUser(req: FastifyRequest) {
  const raw = req.cookies?.[env.cookieName];
  if (!raw) return;
  try {
    req.user = jwt.verify(raw, env.jwtSecret) as SessionUser;
  } catch {
    /* cookie inválida o vencida: se ignora */
  }
}

/** Exige sesión. Usar como preHandler. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  await loadUser(req);
  if (!req.user) return reply.code(401).send({ error: 'No autenticado' });
}

export function requireRole(...roles: SessionUser['role'][]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await loadUser(req);
    if (!req.user) return reply.code(401).send({ error: 'No autenticado' });
    if (!roles.includes(req.user.role)) return reply.code(403).send({ error: 'Sin permisos' });
  };
}

/**
 * Filtro de visibilidad: el asesor ve solo sus leads, el resto ve los de su organización.
 * El aislamiento va en la query, no en la interfaz.
 */
export function scopeForUser(user: SessionUser) {
  const where: Record<string, unknown> = { organizationId: user.organizationId };
  if (user.role === 'asesor') where.ownerId = user.id;
  return where;
}

export async function audit(
  organizationId: string,
  userId: string | null,
  action: string,
  data: { entity?: string; entityId?: string; meta?: unknown; ip?: string } = {}
) {
  await prisma.auditLog.create({
    data: {
      organizationId,
      userId: userId ?? undefined,
      action,
      entity: data.entity,
      entityId: data.entityId,
      meta: (data.meta ?? undefined) as never,
      ip: data.ip,
    },
  });
}
