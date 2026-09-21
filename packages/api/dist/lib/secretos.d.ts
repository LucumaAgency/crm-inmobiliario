/** Devuelve `v1.<iv>.<tag>.<datos>` en base64url. */
export declare function cifrar(texto: string): string;
export declare function descifrar(valor: string): string;
/**
 * Últimos cuatro caracteres, para mostrar en pantalla cuál token está cargado sin
 * devolverlo nunca por la API.
 */
export declare function pista(valorCifrado: string | null | undefined): string | null;
/**
 * Quita credenciales de un texto antes de guardarlo o mostrarlo.
 *
 * Los errores del Graph API incluyen el token entero en el mensaje («Malformed access token
 * EAAO…»). Ese mensaje se guardaba en `lastError` y se pintaba en Ajustes, así que el token
 * acababa en claro en la base y en pantalla: exactamente lo que el cifrado existe para
 * evitar. Un secreto protegido en una columna y filtrado en la de al lado no está protegido.
 */
export declare function redactarSecretos(texto: string): string;
