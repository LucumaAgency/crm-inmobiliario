export declare function driveConfigurado(): boolean;
export interface ArchivoDrive {
    id: string;
    name: string;
    size?: string;
    createdTime: string;
}
/** Lista lo que hay en una carpeta (solo lo que creó esta aplicación). */
export declare function listar(carpetaId: string): Promise<ArchivoDrive[]>;
/** Busca una carpeta por nombre (dentro de `padre`, o en la raíz) y la crea si no existe. */
export declare function carpeta(nombre: string, padre?: string): Promise<string>;
/** Carpeta de una organización: `<raíz>/<slug>`. */
export declare function carpetaDeOrg(slug: string): Promise<string>;
/**
 * Sube un archivo con una subida reanudable, en streaming: un respaldo con audios y
 * proformas puede pesar decenas de MB y no hace falta tenerlo entero en memoria.
 */
export declare function subir(rutaLocal: string, nombre: string, carpetaId: string): Promise<{
    id: string;
}>;
/** Borra para siempre (no a la papelera): son respaldos vencidos por la política de retención. */
export declare function borrar(id: string): Promise<void>;
