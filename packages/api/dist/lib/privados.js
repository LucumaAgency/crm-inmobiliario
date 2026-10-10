/**
 * Archivos privados: los que NO se sirven por URL.
 *
 * `uploads/` se entrega tal cual por `/media` porque guarda planos y renders que el sitio del
 * cliente muestra en público. Una nota de voz es otra cosa: la voz del asesor hablando de un
 * cliente. Vive en `privados/`, que ningún `fastify-static` expone, y solo sale por una ruta
 * de la API que comprueba que quien la pide puede ver ese lead.
 *
 * OJO con el backup: esta carpeta, igual que `uploads/`, va en el backup de archivos de
 * Plesk y no en el volcado de la base.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const privadosDir = process.env.PRIVADOS_DIR
    ? path.resolve(process.env.PRIVADOS_DIR)
    : path.resolve(__dirname, '../../../../privados');
/** Una nota de 5 minutos en opus ronda los 2-3 MB; 8 MB deja margen sin abrir la puerta. */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
/**
 * Formatos que graban los navegadores: Chrome y Android dan webm/opus, Safari da mp4/aac.
 * Se valida la firma del contenido, no solo el tipo declarado.
 */
const AUDIO = {
    'audio/webm': { ext: '.webm', firma: (b) => b.readUInt32BE(0) === 0x1a45dfa3 },
    'audio/mp4': { ext: '.m4a', firma: (b) => b.subarray(4, 8).toString() === 'ftyp' },
    'audio/x-m4a': { ext: '.m4a', firma: (b) => b.subarray(4, 8).toString() === 'ftyp' },
    'audio/ogg': { ext: '.ogg', firma: (b) => b.subarray(0, 4).toString() === 'OggS' },
    'audio/mpeg': { ext: '.mp3', firma: (b) => b.subarray(0, 3).toString() === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
    'audio/wav': { ext: '.wav', firma: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE' },
};
/** `audio/webm;codecs=opus` → `audio/webm`. */
export function mimeBase(mime) {
    return mime.split(';')[0].trim().toLowerCase();
}
export async function guardarAudio(organizationId, contenido, mimeDeclarado) {
    if (contenido.length < 12)
        return { error: 'La grabación está vacía.' };
    if (contenido.length > MAX_AUDIO_BYTES)
        return { error: 'La grabación es demasiado larga.' };
    const mime = mimeBase(mimeDeclarado);
    const tipo = AUDIO[mime];
    if (!tipo)
        return { error: `Formato de audio no admitido (${mime}).` };
    if (!tipo.firma(contenido))
        return { error: 'El contenido no corresponde a un audio válido.' };
    const hash = crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 32);
    const relativa = path.posix.join(organizationId, 'voz', hash.slice(0, 2), hash + tipo.ext);
    const destino = path.join(privadosDir, relativa);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, contenido);
    return { ruta: relativa, bytes: contenido.length, mime };
}
/** Ruta absoluta de un archivo privado, sin permitir salir de la carpeta. */
export function rutaPrivada(relativa) {
    const abs = path.resolve(privadosDir, relativa);
    if (!abs.startsWith(privadosDir + path.sep))
        throw new Error('Ruta privada inválida');
    return abs;
}
