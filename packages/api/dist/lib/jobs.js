import { prisma } from '../db.js';
/**
 * Encola un trabajo. Lo procesa worker.ts, invocado por una tarea programada de Plesk.
 * No usamos setInterval dentro del proceso: Passenger duerme la app cuando no hay tráfico.
 */
export async function enqueue(type, payload, runAt = new Date()) {
    return prisma.job.create({
        data: { type, payload: payload, runAt },
    });
}
/** Backoff exponencial: 1m, 5m, 15m, 1h, 6h, 24h. */
export function backoffMinutes(attempt) {
    const table = [1, 5, 15, 60, 360, 1440];
    return table[Math.min(attempt, table.length - 1)];
}
