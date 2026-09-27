export interface Propuesta {
    resumen: string;
    tipo: 'llamada' | 'whatsapp' | 'email' | 'visita' | 'nota';
    siguientePaso: {
        tipo: 'llamada' | 'whatsapp' | 'email' | 'visita';
        /** ISO 8601 con zona de Lima, o null si la nota no dice cuándo. */
        cuando: string | null;
        descripcion: string;
    } | null;
}
/** Lo ejecuta la cola. Los errores transitorios se propagan para que reintente. */
export declare function procesarNotaVoz(notaId: string): Promise<void>;
