/**
 * Cifrado de credenciales de terceros guardadas en la base.
 *
 * El page access token de Meta no es una contraseña nuestra que podamos guardar como
 * hash: hay que presentarlo tal cual al Graph API, así que tiene que poder recuperarse.
 * Lo que sí se puede es que no viaje en claro en el volcado de la base. Un backup de
 * MariaDB baja por el panel de Plesk como un archivo cualquiera; con el token en claro,
 * quien lo abra puede leer los datos personales de todos los leads de Meta del cliente
 * sin tocar el CRM.
 *
 * AES-256-GCM: cifra y además autentica, así que un valor manipulado falla al descifrar
 * en vez de devolver basura silenciosamente.
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
const SAL = 'lcrm-secretos-v1';
let clave = null;
/**
 * La clave sale de `SECRETS_KEY` si existe y, si no, se deriva de `JWT_SECRET`.
 *
 * El respaldo no es pereza: `JWT_SECRET` ya es obligatorio en producción y ya es el
 * secreto que compromete la aplicación entera si se filtra, así que atar a él el cifrado
 * no amplía la superficie. Y evita que un despliegue existente deje de arrancar por una
 * variable nueva. Definir `SECRETS_KEY` aparte es mejor: permite rotar la sesión sin
 * perder los tokens guardados.
 */
function obtenerClave() {
    if (clave)
        return clave;
    const material = process.env.SECRETS_KEY?.trim() || env.jwtSecret;
    clave = crypto.scryptSync(material, SAL, 32);
    return clave;
}
/** Devuelve `v1.<iv>.<tag>.<datos>` en base64url. */
export function cifrar(texto) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', obtenerClave(), iv);
    const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
    const tag = c.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), datos.toString('base64url')].join('.');
}
export function descifrar(valor) {
    const [version, iv, tag, datos] = valor.split('.');
    if (version !== 'v1' || !iv || !tag || !datos) {
        throw new Error('Secreto con formato desconocido');
    }
    const d = crypto.createDecipheriv('aes-256-gcm', obtenerClave(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(datos, 'base64url')), d.final()]).toString('utf8');
}
/**
 * Últimos cuatro caracteres, para mostrar en pantalla cuál token está cargado sin
 * devolverlo nunca por la API.
 */
export function pista(valorCifrado) {
    if (!valorCifrado)
        return null;
    try {
        const claro = descifrar(valorCifrado);
        return `…${claro.slice(-4)}`;
    }
    catch {
        return null;
    }
}
/**
 * Quita credenciales de un texto antes de guardarlo o mostrarlo.
 *
 * Los errores del Graph API incluyen el token entero en el mensaje («Malformed access token
 * EAAO…»). Ese mensaje se guardaba en `lastError` y se pintaba en Ajustes, así que el token
 * acababa en claro en la base y en pantalla: exactamente lo que el cifrado existe para
 * evitar. Un secreto protegido en una columna y filtrado en la de al lado no está protegido.
 */
export function redactarSecretos(texto) {
    return texto
        // Tokens de Meta: empiezan por EAA y siguen con base64url.
        .replace(/\bEAA[A-Za-z0-9_-]{20,}/g, 'EAA…<oculto>')
        .replace(/(access_token=)[^&\s]+/gi, '$1<oculto>')
        .replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/gi, '$1<oculto>');
}
