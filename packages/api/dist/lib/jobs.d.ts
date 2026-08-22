export type JobType = 'email.send' | 'webhook.deliver' | 'sla.check' | 'conversion.push' | 'retention.purge';
/**
 * Encola un trabajo. Lo procesa worker.ts, invocado por una tarea programada de Plesk.
 * No usamos setInterval dentro del proceso: Passenger duerme la app cuando no hay tráfico.
 */
export declare function enqueue(type: JobType, payload: unknown, runAt?: Date): Promise<{
    id: string;
    type: string;
    payload: import("@prisma/client/runtime/library").JsonValue;
    status: import(".prisma/client").$Enums.JobStatus;
    attempts: number;
    maxAttempts: number;
    lastError: string | null;
    runAt: Date;
    lockedAt: Date | null;
    lockedBy: string | null;
    createdAt: Date;
}>;
/** Backoff exponencial: 1m, 5m, 15m, 1h, 6h, 24h. */
export declare function backoffMinutes(attempt: number): number;
