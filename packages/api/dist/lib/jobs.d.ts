export type JobType = 'email.send' | 'webhook.deliver' | 'sla.check' | 'meta.lead.fetch' | 'wa.send' | 'conversion.push' | 'retention.purge';
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
export declare function enqueue(type: JobType, payload: unknown, runAt?: Date): Promise<{
    id: string;
    createdAt: Date;
    lastError: string | null;
    status: import(".prisma/client").$Enums.JobStatus;
    type: string;
    payload: import("@prisma/client/runtime/library").JsonValue;
    attempts: number;
    maxAttempts: number;
    runAt: Date;
    lockedAt: Date | null;
    lockedBy: string | null;
}>;
/** Backoff exponencial: 1m, 5m, 15m, 1h, 6h, 24h. */
export declare function backoffMinutes(attempt: number): number;
