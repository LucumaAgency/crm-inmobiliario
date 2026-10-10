import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Directorio de logs: `logs/` en la raíz del proyecto, o lo que diga LOG_DIR.
 *
 * Vive FUERA del document root (que es `public/`), así que nginx nunca lo publica.
 * Comprobado en el despliegue: `/logs/app.txt` devuelve el SPA, no el archivo.
 */
export const logDir = process.env.LOG_DIR
    ? path.resolve(process.env.LOG_DIR)
    : path.resolve(__dirname, '../../../../logs');
// Extensión .txt a propósito: el Administrador de archivos de Plesk no abre .log
// en su visor, obliga a descargarlo o a renombrarlo.
export const logFile = path.join(logDir, 'app.txt');
let stream = null;
/**
 * Stream de escritura al archivo de log, o null si el disco no deja escribir.
 *
 * Un log que no se puede abrir no debe tumbar la aplicación: se avisa por consola
 * una vez y la API sigue funcionando contra stdout. Perder trazas es molesto;
 * perder leads porque el disco está lleno, no.
 */
export function getLogStream() {
    if (stream)
        return stream;
    try {
        fs.mkdirSync(logDir, { recursive: true });
        stream = fs.createWriteStream(logFile, { flags: 'a' });
        stream.on('error', (err) => {
            console.error('[log] no se pudo escribir en', logFile, err.message);
            stream = null;
        });
        return stream;
    }
    catch (err) {
        console.error('[log] no se pudo abrir', logFile, err.message);
        return null;
    }
}
/**
 * Escribe una línea suelta en el log, además de en consola.
 *
 * Para lo que no pasa por el logger de Fastify: el arranque y los avisos del
 * mailer de desarrollo.
 */
export function logLine(...partes) {
    escribir(console.log, partes);
}
/**
 * Como `logLine`, pero por **stderr**.
 *
 * La tarea programada de Plesk decide si avisar mirando la salida de error, no el
 * código de salida: un fallo que solo escribe en stdout deja el aviso «Solo errores»
 * mudo, y el worker puede llevar semanas roto sin que nadie se entere. Todo lo que
 * sea un fallo va por aquí.
 */
export function logError(...partes) {
    escribir(console.error, partes);
}
function escribir(salida, partes) {
    const texto = partes
        .map((p) => {
        if (typeof p === 'string')
            return p;
        if (p instanceof Error)
            return p.stack ?? p.message;
        return JSON.stringify(p);
    })
        .join(' ');
    salida(texto);
    getLogStream()?.write(`${new Date().toISOString()} ${texto}\n`);
}
