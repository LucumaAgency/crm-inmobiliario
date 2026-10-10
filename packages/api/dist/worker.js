/**
 * Worker de la cola de trabajos.
 *
 * Se invoca desde una tarea programada (ver `bin/worker.sh` y `docs/DEPLOY-PLESK.md`):
 *     bin/worker.sh
 *
 * NO se usa setInterval dentro del proceso de la API: Passenger duerme la aplicación
 * cuando no hay tráfico, así que los temporizadores internos no son confiables justo
 * en las horas muertas, que es cuando más importa que el reintento ocurra.
 *
 * La lógica vive en `services/cola.ts`, compartida con el disparo en línea de la API.
 * Aquí solo está la envoltura de línea de comandos: una pasada y salir.
 */
import { prisma } from './db.js';
import { logError } from './lib/log.js';
import { desactivarEnLinea, procesarCola } from './services/cola.js';
// Este proceso ya es el que procesa: encolar aquí no debe redisparar nada.
desactivarEnLinea();
async function main() {
    await procesarCola();
    await prisma.$disconnect();
}
main().catch(async (err) => {
    logError('[worker] error fatal:', err);
    await prisma.$disconnect();
    process.exit(1);
});
