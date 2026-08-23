import { prisma } from '../db.js';
/**
 * Encola un trabajo.
 *
 * Lo procesa la tarea programada (`bin/worker.sh`). Además, si el trabajo ya está
 * vencido, se pide un procesado **en línea** sin esperarlo: así el aviso al asesor sale
 * en segundos en vez de esperar al siguiente minuto, y sigue saliendo en servidores
 * donde no se puede configurar un cron por minuto. Ver `services/cola.ts`.
 *
 * Los trabajos con espera (una alerta de SLA a los 15 minutos) no disparan nada: para
 * esos hace falta que alguien despierte la aplicación entonces, y de eso solo puede
 * encargarse la tarea programada.
 */
export async function enqueue(type, payload, runAt = new Date()) {
    const job = await prisma.job.create({
        data: { type, payload: payload, runAt },
    });
    if (runAt.getTime() <= Date.now()) {
        const { dispararCola } = await import('../services/cola.js');
        dispararCola();
    }
    return job;
}
/** Backoff exponencial: 1m, 5m, 15m, 1h, 6h, 24h. */
export function backoffMinutes(attempt) {
    const table = [1, 5, 15, 60, 360, 1440];
    return table[Math.min(attempt, table.length - 1)];
}
