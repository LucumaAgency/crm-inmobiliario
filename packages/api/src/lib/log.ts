import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Directorio de logs: `logs/` en la raíz del proyecto, o lo que diga LOG_DIR.
 *
 * Vive FUERA del document root (que es `public/`), así que nginx nunca lo publica.
 * Comprobado en el despliegue: `/logs/app.log` devuelve el SPA, no el archivo.
 */
export const logDir = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.resolve(__dirname, '../../../../logs');

export const logFile = path.join(logDir, 'app.log');

let stream: fs.WriteStream | null = null;

/**
 * Stream de escritura al archivo de log, o null si el disco no deja escribir.
 *
 * Un log que no se puede abrir no debe tumbar la aplicación: se avisa por consola
 * una vez y la API sigue funcionando contra stdout. Perder trazas es molesto;
 * perder leads porque el disco está lleno, no.
 */
export function getLogStream(): fs.WriteStream | null {
  if (stream) return stream;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    stream = fs.createWriteStream(logFile, { flags: 'a' });
    stream.on('error', (err) => {
      console.error('[log] no se pudo escribir en', logFile, err.message);
      stream = null;
    });
    return stream;
  } catch (err) {
    console.error('[log] no se pudo abrir', logFile, (err as Error).message);
    return null;
  }
}

/**
 * Escribe una línea suelta en el log, además de en consola.
 *
 * Para lo que no pasa por el logger de Fastify: el arranque y los avisos del
 * mailer de desarrollo.
 */
export function logLine(...partes: unknown[]) {
  const texto = partes
    .map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ');
  console.log(texto);
  getLogStream()?.write(`${new Date().toISOString()} ${texto}\n`);
}
