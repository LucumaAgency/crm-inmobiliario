import fs from 'node:fs';
/**
 * Directorio de logs: `logs/` en la raíz del proyecto, o lo que diga LOG_DIR.
 *
 * Vive FUERA del document root (que es `public/`), así que nginx nunca lo publica.
 * Comprobado en el despliegue: `/logs/app.txt` devuelve el SPA, no el archivo.
 */
export declare const logDir: string;
export declare const logFile: string;
/**
 * Stream de escritura al archivo de log, o null si el disco no deja escribir.
 *
 * Un log que no se puede abrir no debe tumbar la aplicación: se avisa por consola
 * una vez y la API sigue funcionando contra stdout. Perder trazas es molesto;
 * perder leads porque el disco está lleno, no.
 */
export declare function getLogStream(): fs.WriteStream | null;
/**
 * Escribe una línea suelta en el log, además de en consola.
 *
 * Para lo que no pasa por el logger de Fastify: el arranque y los avisos del
 * mailer de desarrollo.
 */
export declare function logLine(...partes: unknown[]): void;
/**
 * Como `logLine`, pero por **stderr**.
 *
 * La tarea programada de Plesk decide si avisar mirando la salida de error, no el
 * código de salida: un fallo que solo escribe en stdout deja el aviso «Solo errores»
 * mudo, y el worker puede llevar semanas roto sin que nadie se entere. Todo lo que
 * sea un fallo va por aquí.
 */
export declare function logError(...partes: unknown[]): void;
