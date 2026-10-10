import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
/**
 * Contraseñas con scrypt de `node:crypto`: sin dependencias nativas que compilar en Plesk.
 *
 * Los parámetros viajan dentro del hash (`scrypt$N$r$p$sal$hash`), así que subir el coste
 * más adelante no invalida las contraseñas ya guardadas.
 */
const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;
function scrypt(clave, sal, largo, opts) {
    return new Promise((ok, mal) => scryptCb(clave, sal, largo, opts, (err, buf) => (err ? mal(err) : ok(buf))));
}
export async function hashPassword(clave) {
    const sal = randomBytes(16);
    const hash = await scrypt(clave, sal, LARGO, { N, r: R, p: P });
    return ['scrypt', N, R, P, sal.toString('base64url'), hash.toString('base64url')].join('$');
}
export async function verifyPassword(clave, guardado) {
    const [algo, n, r, p, sal, hash] = guardado.split('$');
    if (algo !== 'scrypt' || !sal || !hash)
        return false;
    const esperado = Buffer.from(hash, 'base64url');
    const calculado = await scrypt(clave, Buffer.from(sal, 'base64url'), esperado.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
    });
    return calculado.length === esperado.length && timingSafeEqual(calculado, esperado);
}
/**
 * Hash de relleno para cuando el correo no existe o no tiene contraseña.
 *
 * Verificar contra él cuesta lo mismo que contra uno real: sin esto, la respuesta rápida
 * delataría qué correos tienen cuenta.
 */
let relleno;
export function hashDeRelleno() {
    relleno ??= hashPassword(randomBytes(16).toString('hex'));
    return relleno;
}
/** Contraseña aleatoria legible, para el script de emergencia. */
export function generarPassword() {
    return randomBytes(12).toString('base64url');
}
