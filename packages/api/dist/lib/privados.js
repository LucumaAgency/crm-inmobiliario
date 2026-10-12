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
/**
 * Adjuntos que el asesor manda por WhatsApp desde la ficha.
 *
 * Límites de la Cloud API: imagen 5 MB (solo jpeg/png), video 16 MB (mp4), documento
 * 100 MB. El tope de subida de la plataforma es 8 MB, así que el video queda acotado ahí.
 * Se valida la firma del contenido, no solo la extensión: un .pdf que no empieza con
 * %PDF no sale al cliente.
 */
export const MAX_ADJUNTO_WA_BYTES = 8 * 1024 * 1024;
const MAX_IMAGEN_WA_BYTES = 5 * 1024 * 1024;
const ADJUNTO_WA = {
    'image/jpeg': { ext: '.jpg', tipo: 'image', firma: (b) => b[0] === 0xff && b[1] === 0xd8 },
    'image/png': { ext: '.png', tipo: 'image', firma: (b) => b.readUInt32BE(0) === 0x89504e47 },
    'video/mp4': { ext: '.mp4', tipo: 'video', firma: (b) => b.subarray(4, 8).toString() === 'ftyp' },
    'application/pdf': { ext: '.pdf', tipo: 'document', firma: (b) => b.subarray(0, 4).toString() === '%PDF' },
    'application/msword': { ext: '.doc', tipo: 'document', firma: (b) => b.readUInt32BE(0) === 0xd0cf11e0 },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', tipo: 'document', firma: (b) => b[0] === 0x50 && b[1] === 0x4b },
    'application/vnd.ms-excel': { ext: '.xls', tipo: 'document', firma: (b) => b.readUInt32BE(0) === 0xd0cf11e0 },
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { ext: '.xlsx', tipo: 'document', firma: (b) => b[0] === 0x50 && b[1] === 0x4b },
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': { ext: '.pptx', tipo: 'document', firma: (b) => b[0] === 0x50 && b[1] === 0x4b },
};
export const ADJUNTO_WA_ACCEPT = Object.keys(ADJUNTO_WA);
export async function guardarAdjuntoWa(organizationId, contenido, mimeDeclarado, nombreOriginal) {
    if (contenido.length < 8)
        return { error: 'El archivo está vacío.' };
    if (contenido.length > MAX_ADJUNTO_WA_BYTES)
        return { error: 'El archivo supera 8 MB.' };
    const mime = mimeBase(mimeDeclarado);
    const tipo = ADJUNTO_WA[mime];
    if (!tipo)
        return { error: 'Formato no admitido. Se puede mandar JPG, PNG, MP4, PDF, Word, Excel o PowerPoint.' };
    if (!tipo.firma(contenido))
        return { error: 'El contenido del archivo no corresponde a su tipo.' };
    if (tipo.tipo === 'image' && contenido.length > MAX_IMAGEN_WA_BYTES)
        return { error: 'WhatsApp admite imágenes de hasta 5 MB.' };
    const hash = crypto.createHash('sha256').update(contenido).digest('hex').slice(0, 32);
    const relativa = path.posix.join(organizationId, 'wa-out', hash.slice(0, 2), hash + tipo.ext);
    const destino = path.join(privadosDir, relativa);
    await fs.promises.mkdir(path.dirname(destino), { recursive: true });
    await fs.promises.writeFile(destino, contenido);
    // Nombre limpio para el cliente: sin rutas ni comillas, con la extensión real.
    const base = path.basename(nombreOriginal || 'archivo').replace(/["\\/]/g, '').slice(0, 120);
    const filename = base.toLowerCase().endsWith(tipo.ext) ? base : base.replace(/\.[A-Za-z0-9]{1,5}$/, '') + tipo.ext;
    return { ruta: relativa, bytes: contenido.length, mime, tipo: tipo.tipo, filename };
}
/** Ruta absoluta de un archivo privado, sin permitir salir de la carpeta. */
export function rutaPrivada(relativa) {
    const abs = path.resolve(privadosDir, relativa);
    if (!abs.startsWith(privadosDir + path.sep))
        throw new Error('Ruta privada inválida');
    return abs;
}
