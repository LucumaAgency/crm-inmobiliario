/** Todo lo que el retorno de Meta necesita saber, firmado para que no se pueda inventar. */
export interface EstadoOAuth {
    organizationId: string;
    userId: string;
    projectId: string | null;
    /** Vuelve al host que empezó: con varios clientes, cada uno vive en su subdominio. */
    volverA: string;
    nonce: string;
    exp: number;
}
export declare function oauthDisponible(): boolean;
/** Ruta del callback; se registra tal cual en Meta, una por dominio del CRM. */
export declare function redirectUri(baseUrl: string): string;
export declare function firmarEstado(estado: EstadoOAuth): string;
/**
 * Devuelve el estado si la firma vale, no venció y el nonce coincide con el de la cookie.
 *
 * El nonce en cookie es lo que impide el CSRF de OAuth: sin él, un tercero podría hacer
 * que un gerente conecte SU página al CRM del gerente enviándole un enlace de retorno
 * ya armado. Con el nonce, el retorno solo vale en el navegador que empezó.
 */
export declare function leerEstado(firmado: string | undefined, nonceCookie: string | undefined): EstadoOAuth | null;
export declare function nuevoNonce(): string;
export declare function urlDeAutorizacion(estadoFirmado: string, redirect: string): string;
/** Canjea el `code` del retorno por el token de la integración. */
export declare function canjearCodigo(code: string, redirect: string): Promise<string>;
interface PaginaGraph {
    id: string;
    name: string;
    access_token: string;
}
/**
 * Páginas que el cliente autorizó en el diálogo, con su token de página.
 *
 * `/me/accounts` es el camino normal. Si viene vacío —pasa con algunos tokens de usuario
 * del sistema— se mira qué páginas concedió el diálogo (`granular_scopes` del
 * `debug_token`) y se pide el token de cada una directamente.
 */
export declare function paginasAutorizadas(token: string): Promise<PaginaGraph[]>;
export interface ResultadoConexion {
    conectadas: string[];
    /** Páginas que ya estaban en OTRA organización: no se tocan y no se dice cuál. */
    ajenas: string[];
    /** Guardadas, pero la suscripción de la app falló: los leads no llegarán hasta arreglarlo. */
    sinSuscribir: Array<{
        nombre: string;
        error: string;
    }>;
}
/**
 * Guarda (o renueva) cada página en la organización y suscribe la app.
 *
 * Una página que ya estaba conectada en esta misma organización se actualiza: es la
 * forma de renovar un token sin desconectar nada. Una que está en otra organización se
 * deja como está: el `pageId` es único en toda la instalación, y el diálogo de Meta no es
 * prueba suficiente de que la página cambió de dueño.
 */
export declare function conectarPaginas(estado: EstadoOAuth, paginas: PaginaGraph[]): Promise<ResultadoConexion>;
export declare function mensajeDeError(err: unknown): string;
export {};
