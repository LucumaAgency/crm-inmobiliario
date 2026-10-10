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
/** Ruta absoluta de un archivo privado, sin permitir salir de la carpeta. */
export declare function rutaPrivada(relativa: string): string;
