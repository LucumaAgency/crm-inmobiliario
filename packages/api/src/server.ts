import { buildApp } from './app.js';
import { env } from './env.js';

/**
 * Arranque de la API.
 *
 * Sin `await` en el nivel superior del módulo, a propósito: Passenger carga este
 * archivo con `require()` desde `node-loader.js`, y Node rechaza un grafo ESM con
 * top-level await con `ERR_REQUIRE_ASYNC_MODULE`. El síntoma en el navegador es un
 * genérico «Web application could not be started». Todo el await vive dentro de
 * `main()`, que es una función normal.
 */
async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.port, host: '0.0.0.0' });
    console.log(`Lucuma CRM API escuchando en :${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('No se pudo arrancar la API:', err);
  process.exit(1);
});
