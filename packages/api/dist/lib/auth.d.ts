import type { FastifyReply, FastifyRequest } from 'fastify';
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
export declare function issueSession(reply: FastifyReply, user: SessionUser): void;
export declare function clearSession(reply: FastifyReply): void;
/** Carga req.user si hay cookie válida. No corta la petición. */
export declare function loadUser(req: FastifyRequest): Promise<void>;
/** Exige sesión. Usar como preHandler. */
export declare function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<undefined>;
export declare function requireRole(...roles: SessionUser['role'][]): (req: FastifyRequest, reply: FastifyReply) => Promise<undefined>;
/**
 * Filtro de visibilidad: el asesor ve solo sus leads, el resto ve los de su organización.
 * El aislamiento va en la query, no en la interfaz.
 */
export declare function scopeForUser(user: SessionUser): Record<string, unknown>;
export declare function audit(organizationId: string, userId: string | null, action: string, data?: {
    entity?: string;
    entityId?: string;
    meta?: unknown;
    ip?: string;
}): Promise<void>;
