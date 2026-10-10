export declare function hashPassword(clave: string): Promise<string>;
export declare function verifyPassword(clave: string, guardado: string): Promise<boolean>;
export declare function hashDeRelleno(): Promise<string>;
/** Contraseña aleatoria legible, para el script de emergencia. */
export declare function generarPassword(): string;
