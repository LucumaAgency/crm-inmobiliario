import type { FastifyReply, FastifyRequest } from 'fastify';
import { type Permiso, type RolBase } from '@lucuma-crm/shared';
export interface SessionUser {
    id: string;
    organizationId: string;
    role: RolBase;
    email: string;
    name: string;
    /** Permisos efectivos, calculados en cada petición (ver `loadUser`). */
    permissions: Permiso[];
    /** Nombre del rol que se muestra: el base o el personalizado. */
    roleName: string;
}
/** Permisos de un usuario: los del rol personalizado si tiene, si no los del rol base. */
export declare function permisosDe(user: {
    role: RolBase;
    customRole?: {
        permissions: unknown;
        name: string;
    } | null;
}): {
    permissions: ("leads.ver_todos" | "leads.editar" | "leads.reasignar" | "leads.exportar" | "reportes.ver" | "inventario.editar" | "inventario.precios" | "embudo.configurar" | "usuarios.gestionar" | "canales.configurar" | "registro.ver")[];
    roleName: string;
};
export declare function olvidarPermisos(userId?: string): void;
declare module 'fastify' {
    interface FastifyRequest {
        user?: SessionUser;
    }
}
/** En la cookie solo va la identidad; los permisos se calculan al cargar la sesión. */
export type SessionClaims = Pick<SessionUser, 'id' | 'organizationId' | 'role' | 'email' | 'name'>;
export declare function issueSession(reply: FastifyReply, user: SessionClaims): void;
export declare function clearSession(reply: FastifyReply): void;
/** Carga req.user si hay cookie válida. No corta la petición. */
export declare function loadUser(req: FastifyRequest): Promise<void>;
/** Exige sesión. Usar como preHandler. */
export declare function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<undefined>;
export declare function requireRole(...roles: SessionUser['role'][]): (req: FastifyRequest, reply: FastifyReply) => Promise<undefined>;
export declare function tiene(user: SessionUser | undefined, ...permisos: Permiso[]): boolean;
/** Exige al menos uno de los permisos. Usar como preHandler. */
export declare function requirePermiso(...permisos: Permiso[]): (req: FastifyRequest, reply: FastifyReply) => Promise<undefined>;
/**
 * Filtro de visibilidad: quien no puede ver los leads del equipo ve solo los suyos.
 * El aislamiento va en la query, no en la interfaz.
 */
export declare function scopeForUser(user: SessionUser): Record<string, unknown>;
export declare function audit(organizationId: string, userId: string | null, action: string, data?: {
    entity?: string;
    entityId?: string;
    meta?: unknown;
    ip?: string;
}): Promise<void>;
