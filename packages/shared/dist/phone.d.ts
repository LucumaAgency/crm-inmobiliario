/**
 * Normalización de teléfonos peruanos a E.164.
 * El teléfono es la clave de deduplicación más usada en el rubro, así que tiene que
 * quedar guardado siempre en el mismo formato.
 */
export declare function normalizePhonePE(input: string | null | undefined): string | null;
export declare function normalizeEmail(input: string | null | undefined): string | null;
export declare function normalizeDocument(input: string | null | undefined): string | null;
