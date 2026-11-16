export type ModoAlta = 'coexistencia' | 'nuevo';
/** Meta da 24 h desde el alta para pedir la sincronización; después hay que repetirla. */
export declare const PLAZO_SYNC_MS: number;
export declare function altaDisponible(): boolean;
/** Datos públicos que la página puente necesita para iniciar el SDK. */
export declare function configPublica(): {
    appId: string;
    configId: string;
    graphVersion: string;
};
export declare function crearPase(datos: {
    organizationId: string;
    userId: string;
    modo: ModoAlta;
    abrirLeads: boolean;
    ownerUserId: string | null;
    projectId: string | null;
    volverA: string;
}): Promise<{
    url: string;
    expiresAt: Date;
}>;
/** El pase si vale (sin gastarlo): para que la página puente muestre a quién conecta. */
export declare function verPase(token: string): Promise<({
    organization: {
        name: string;
    };
} & {
    id: string;
    organizationId: string;
    createdAt: Date;
    userId: string;
    projectId: string | null;
    abrirLeads: boolean;
    ownerUserId: string | null;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    resultado: import("@prisma/client/runtime/library").JsonValue | null;
    modo: string;
    volverA: string;
}) | null>;
/** Estado de coexistencia que reporta Meta. Lo usan «Probar conexión» y el diagnóstico. */
export declare function estadoEnMeta(waNumberId: string): Promise<{
    ok: true;
    isOnBizApp: boolean;
    platformType: string | null;
    error?: undefined;
} | {
    ok: false;
    error: string;
    isOnBizApp?: undefined;
    platformType?: undefined;
} | null>;
export interface DatosCompletar {
    pase: string;
    code: string;
    /** Lo que mandó Meta por `postMessage` (puede faltar si el navegador no lo entregó). */
    evento?: string;
    wabaId?: string;
    phoneNumberId?: string;
    ip?: string;
}
export interface ResultadoAlta {
    ok: boolean;
    volverA: string;
    numero?: string;
    coexistencia?: boolean;
    avisos: string[];
    error?: string;
}
export declare class ErrorAlta extends Error {
    readonly volverA: string | null;
    constructor(mensaje: string, volverA?: string | null);
}
export declare function completarAlta(d: DatosCompletar): Promise<ResultadoAlta>;
/** Deja constancia de un alta que terminó en Meta sin código (cancelada o con error). */
export declare function registrarFinSinCodigo(token: string, evento: Record<string, unknown>): Promise<void>;
/**
 * Pide a Meta los contactos y el historial del número en coexistencia.
 *
 * Cada tipo se puede pedir UNA vez por alta y dentro de 24 h. Si falla se lanza para que
 * la cola reintente (1, 5, 15, 60, 360 min: cabe en el plazo). Pasadas las 24 h no se
 * insiste: queda el error a la vista y hay que repetir el alta.
 */
export declare function sincronizarCoexistencia(waNumberId: string): Promise<void>;
