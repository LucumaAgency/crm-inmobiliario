/**
 * Archivos subidos: planos y renders de las tipologías.
 *
 * Viven en `uploads/` en la raíz de la aplicación, **fuera de `public/`**. Es deliberado:
 * `public/` se borra y se reescribe en cada build (`emptyOutDir`) y además llega versionado
 * desde GitHub en cada despliegue, así que cualquier archivo subido ahí desaparecería en el
 * primer deploy posterior.
 *
 * En la base se guarda una **ruta relativa**, nunca una URL completa. El día que el disco
 * apriete y toque pasar a almacenamiento de objetos, se migran los archivos y se cambia
 * `urlPublica()`; con URLs completas en cada fila, esa mudanza obligaría a tocar la base.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logError } from './log.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.resolve(__dirname, '../../../../uploads');
/** Prefijo por el que la API sirve los archivos. */
export const MEDIA_PREFIX = '/media';
export const MAX_BYTES = 8 * 1024 * 1024;
/**
 * Tipos permitidos.
 *
 * Lista blanca, no negra: un formulario de subida sin restricción es una invitación a que
 * alguien deje un `.php` o un `.html` en el disco del servidor. Se comprueba además la
 * firma del archivo, porque la extensión y el `Content-Type` los pone quien sube.
 */
const PERMITIDOS = {
    'image/jpeg': { ext: '.jpg', firma: (b) => b[0] === 0xff && b[1] === 0xd8 },
    'image/png': { ext: '.png', firma: (b) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG' },
    'image/webp': { ext: '.webp', firma: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
    'application/pdf': { ext: '.pdf', firma: (b) => b.subarray(0, 4).toString() === '%PDF' },
};
export function tiposPermitidos() {
    return Object.keys(PERMITIDOS);
}
/**
 * Guarda un archivo y devuelve su ruta relativa.
 *
 * El nombre sale del hash del contenido, no del original: evita colisiones, caracteres
 * raros y rutas adivinables, y hace que subir dos veces el mismo plano no ocupe el doble.
 */
export async function guardar(organizationId, contenido, mimeDeclarado) {
    if (contenido.length === 0)
        return { error: 'El archivo está vacío.' };
    if (contenido.length > MAX_BYTES) {
        return { error: `El archivo supera ${Math.round(MAX_BYTES / 1024 / 1024)} MB.` };
    }
    const tipo = PERMITIDOS[mimeDeclarado];
    if (!tipo) {
        return { error: `Tipo no permitido. Se aceptan: ${tiposPermitidos().join(', ')}.` };
    }
    if (!tipo.firma(contenido)) {
        return { error: 'El contenido del archivo no corresponde a su tipo.' };
    }
    const hash = crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 32);
    // Se reparte en dos niveles para no acabar con decenas de miles de archivos en un
    // directorio, que ralentiza el sistema de archivos y el propio administrador de Plesk.
    const relativa = path.posix.join(organizationId, hash.slice(0, 2), hash + tipo.ext);
    const destino = path.join(uploadsDir, relativa);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, contenido);
    return { ruta: relativa, bytes: contenido.length, mime: mimeDeclarado };
}
/** Convierte la ruta guardada en la URL que consume el navegador. */
export function urlPublica(ruta) {
    if (!ruta)
        return null;
    if (/^https?:\/\//i.test(ruta))
        return ruta; // URLs externas de antes de esto
    return `${MEDIA_PREFIX}/${ruta}`;
}
/**
 * Borra un archivo si ninguna otra fila lo usa.
 *
 * Como el nombre es el hash del contenido, dos tipologías con el mismo plano comparten
 * archivo: borrar sin comprobar dejaría a la otra sin él.
 */
export async function borrarSiHuerfano(ruta, sigueEnUso) {
    if (!ruta || sigueEnUso || /^https?:\/\//i.test(ruta))
        return;
    try {
        await fs.promises.unlink(path.join(uploadsDir, ruta));
    }
    catch (err) {
        const e = err;
        if (e.code !== 'ENOENT')
            logError('[media] no se pudo borrar', ruta, e.message);
    }
}
