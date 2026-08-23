/** Procesa un lote. Devuelve cuántos trabajos tomó. */
export declare function procesarCola(): Promise<number>;
/** El proceso del worker no debe redisparar en línea: ya está procesando. */
export declare function desactivarEnLinea(): void;
/**
 * Pide procesar la cola sin bloquear a quien llama.
 *
 * No se espera el resultado a propósito: quien dispara esto es una petición HTTP que
 * está respondiendo a un visitante, y el envío del correo no puede retrasar la respuesta
 * del formulario. Si falla, se registra y el trabajo se queda encolado para el siguiente
 * intento; nunca hace fracasar la captura del lead.
 */
export declare function dispararCola(): void;
