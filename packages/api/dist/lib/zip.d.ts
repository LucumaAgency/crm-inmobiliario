export declare class EscritorZip {
    readonly ruta: string;
    private fd;
    private offset;
    private entradas;
    constructor(ruta: string);
    private escribir;
    agregar(nombre: string, contenido: Buffer | string, fecha?: Date): void;
    cerrar(): void;
    /** Si algo falla a medio camino: cerrar y borrar, para no dejar un ZIP a medias. */
    descartar(): void;
}
/** Lee un ZIP completo a memoria: nombre → contenido. Comprueba el CRC de cada entrada. */
export declare function leerZip(ruta: string): Map<string, Buffer>;
