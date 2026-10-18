export declare const IGV = 0.18;
export declare const PERIODICIDADES: readonly ["mensual", "anual", "unico", "variable", "comision"];
/** Las que generan sus cobros solas. */
export declare const RECURRENTES: string[];
export declare const ESTADOS_SERVICIO: readonly ["activo", "pausado", "terminado"];
export declare const ESTADOS_COBRO: readonly ["pendiente", "pagado", "anulado"];
/** «2026-10» del día de hoy en Lima. */
export declare function mesActual(ahora?: Date): string;
/** «2026-10-18» en Lima. */
export declare function hoyLima(ahora?: Date): string;
/** Fecha de calendario → Date a mediodía UTC (estable al guardarla como DATE). */
export declare function fecha(iso: string): Date;
export declare function isoDe(d: Date): string;
export declare function mesDe(d: Date): string;
export declare function sumarMeses(mes: string, n: number): string;
/** Vencimiento del cobro de un mes: el día de pago, sin pasar del último día del mes. */
export declare function vencimiento(mes: string, dia: number): Date;
/** Del monto pactado a base (ingreso) y total (lo que paga el cliente). */
export declare function importes(amount: number, igvIncluido: boolean): {
    base: number;
    total: number;
};
/**
 * Crea los cobros que falten de los servicios mensuales activos, desde `cobrarDesde` (y el mes
 * de inicio) hasta `hasta`, sin pasar del mes de fin. Idempotente: se puede llamar en cada
 * consulta de la cobranza.
 */
export declare function generarCobros(organizationId: string, hasta: string): Promise<number>;
/**
 * Un correo de resumen a la cuenta de Lucuma de cada organización agencia: cobros que vencen
 * en 3 días, cobros vencidos y renovaciones a 30 días. Cada cosa se avisa una sola vez (marca
 * en la fila). Corre desde el latido, como mucho una vez por hora y entre las 8 y las 20 de Lima.
 */
export declare function avisosCobranza(ahora?: Date): Promise<void>;
