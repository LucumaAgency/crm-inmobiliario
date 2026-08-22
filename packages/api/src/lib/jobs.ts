import { prisma } from '../db.js';

export type JobType =
  | 'email.send'
  | 'webhook.deliver'
  | 'sla.check'
  | 'conversion.push'
  | 'retention.purge';

/**
 * Encola un trabajo. Lo procesa worker.ts, invocado por una tarea programada de Plesk.
 * No usamos setInterval dentro del proceso: Passenger duerme la app cuando no hay tráfico.
 */
export async function enqueue(type: JobType, payload: unknown, runAt = new Date()) {
  return prisma.job.create({
    data: { type, payload: payload as never, runAt },
  });
}

/** Backoff exponencial: 1m, 5m, 15m, 1h, 6h, 24h. */
export function backoffMinutes(attempt: number): number {
  const table = [1, 5, 15, 60, 360, 1440];
  return table[Math.min(attempt, table.length - 1)];
}
