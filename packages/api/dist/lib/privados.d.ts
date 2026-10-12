export declare const privadosDir: string;
/** Una nota de 5 minutos en opus ronda los 2-3 MB; 8 MB deja margen sin abrir la puerta. */
export declare const MAX_AUDIO_BYTES: number;
/** `audio/webm;codecs=opus` → `audio/webm`. */
export declare function mimeBase(mime: string): string;
export declare function guardarAudio(organizationId: string, contenido: Buffer, mimeDeclarado: string): Promise<{
    ruta: string;
    bytes: number;
    mime: string;
} | {
    error: string;
}>;
/**
 * Adjuntos que el asesor manda por WhatsApp desde la ficha.
 *
 * Límites de la Cloud API: imagen 5 MB (solo jpeg/png), video 16 MB (mp4), documento
 * 100 MB. El tope de subida de la plataforma es 8 MB, así que el video queda acotado ahí.
 * Se valida la firma del contenido, no solo la extensión: un .pdf que no empieza con
 * %PDF no sale al cliente.
 */
export declare const MAX_ADJUNTO_WA_BYTES: number;
export declare const ADJUNTO_WA_ACCEPT: string[];
export declare function guardarAdjuntoWa(organizationId: string, contenido: Buffer, mimeDeclarado: string, nombreOriginal: string): Promise<{
    ruta: string;
    bytes: number;
    mime: string;
    tipo: 'image' | 'video' | 'document';
    filename: string;
} | {
    error: string;
}>;
/** Ruta absoluta de un archivo privado, sin permitir salir de la carpeta. */
export declare function rutaPrivada(relativa: string): string;
