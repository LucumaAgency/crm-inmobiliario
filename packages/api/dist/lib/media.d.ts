export declare const uploadsDir: string;
/** Prefijo por el que la API sirve los archivos. */
export declare const MEDIA_PREFIX = "/media";
export declare const MAX_BYTES: number;
export declare function tiposPermitidos(): string[];
export interface Guardado {
    ruta: string;
    bytes: number;
    mime: string;
}
/**
 * Guarda un archivo y devuelve su ruta relativa.
 *
 * El nombre sale del hash del contenido, no del original: evita colisiones, caracteres
 * raros y rutas adivinables, y hace que subir dos veces el mismo plano no ocupe el doble.
 */
export declare function guardar(organizationId: string, contenido: Buffer, mimeDeclarado: string): Promise<Guardado | {
    error: string;
}>;
/** Convierte la ruta guardada en la URL que consume el navegador. */
export declare function urlPublica(ruta: string | null | undefined): string | null;
/**
 * Borra un archivo si ninguna otra fila lo usa.
 *
 * Como el nombre es el hash del contenido, dos tipologías con el mismo plano comparten
 * archivo: borrar sin comprobar dejaría a la otra sin él.
 */
export declare function borrarSiHuerfano(ruta: string | null | undefined, sigueEnUso: boolean): Promise<void>;
