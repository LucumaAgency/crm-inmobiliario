/** Devuelve `v1.<iv>.<tag>.<datos>` en base64url. */
export declare function cifrar(texto: string): string;
export declare function descifrar(valor: string): string;
/**
 * Últimos cuatro caracteres, para mostrar en pantalla cuál token está cargado sin
 * devolverlo nunca por la API.
 */
export declare function pista(valorCifrado: string | null | undefined): string | null;
