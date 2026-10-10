/** Public key: viaja en el HTML del sitio. Restringida por dominio, no por secreto. */
export declare function generatePublicKey(): string;
/** Secret key: vive solo en el servidor del sitio (opción de WordPress). */
export declare function generateSecretKey(): string;
export declare function hashKey(key: string): string;
export declare function safeEqual(a: string, b: string): boolean;
/** ¿El Origin de la petición está en la lista blanca del sitio? */
export declare function originAllowed(origin: string | undefined, allowed: unknown): boolean;
