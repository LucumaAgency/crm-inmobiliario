/**
 * Latido externo de la cola.
 *
 * Existe porque en este servidor la tarea programada de Plesk no se puede usar: corre
 * enjaulada, sin Node ni coreutils, y el plan solo permite frecuencia horaria (ver
 * `docs/DEPLOY-PLESK.md` §4). El problema de fondo no es el cron en sí, es que
 * **Passenger duerme la aplicación cuando no hay tráfico**: los trabajos con espera —la
 * alerta de SLA a los 15 minutos, un reintento con backoff— necesitan que alguien
 * despierte el proceso en ese momento, y sin tráfico no hay nadie.
 *
 * Una petición HTTP hace exactamente eso. Así que un cron externo llamando a esta ruta
 * cada minuto sustituye al worker local: la petición despierta a Passenger y la cola se
 * procesa igual.
 *
 * No reemplaza a la suscripción propia de Plesk (decisión 18): esa resuelve además el
 * aislamiento respecto a los 72 dominios que hoy comparten usuario y el backup propio,
 * que ningún atajo arregla. Resuelve el SLA y los reintentos, que es lo que hoy incumple
 * lo que el producto promete.
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
import { logError, logLine } from '../lib/log.js';
import { procesarCola } from '../services/cola.js';
/**
 * Tope de tiempo de una llamada.
 *
 * Hay que terminar antes de que corte el proxy que haya delante (nginx en Plesk, y el
 * propio servicio de cron externo, que suele cortar a los 30 s). Si queda trabajo, lo
 * toma el latido siguiente: la cola es persistente, no se pierde nada.
 */
const LIMITE_MS = 25_000;
const MAX_VUELTAS = 20;
export default async function cronRoutes(app) {
    const manejar = async (req, reply) => {
        if (!env.cronToken) {
            logError('cron: latido recibido sin CRON_TOKEN configurado');
            return reply.code(503).send({ error: 'Latido no configurado' });
        }
        if (!autorizado(req)) {
            logError('cron: latido con token incorrecto desde', req.ip);
            return reply.code(401).send({ error: 'No autorizado' });
        }
        const inicio = Date.now();
        let total = 0;
        let vueltas = 0;
        try {
            /**
             * Se procesa en vueltas hasta vaciar la cola, no un solo lote: si se acumularon
             * cien trabajos durante una caída, un lote de 25 por minuto tardaría cuatro
             * minutos en drenarlos y las alertas de SLA llegarían tarde igual.
             */
            let tomados = 0;
            do {
                tomados = await procesarCola();
                total += tomados;
                vueltas += 1;
            } while (tomados > 0 && vueltas < MAX_VUELTAS && Date.now() - inicio < LIMITE_MS);
        }
        catch (err) {
            logError('cron: fallo procesando la cola', err);
            return reply.code(500).send({ error: 'Fallo procesando la cola' });
        }
        /**
         * Solo se escribe en el log si hubo trabajo. Un latido por minuto son 1.440 líneas
         * diarias de «no había nada», y un log que nadie puede leer es un log que no existe.
         */
        if (total > 0)
            logLine(`cron: ${total} trabajo(s) en ${Date.now() - inicio} ms`);
        return { ok: true, jobs: total, ms: Date.now() - inicio, pendiente: vueltas >= MAX_VUELTAS };
    };
    /**
     * GET y POST: muchos servicios de cron gratuitos solo saben hacer GET. No es una
     * escritura que un navegador pueda provocar por accidente —hace falta el token— y la
     * cola es idempotente respecto a llamadas de más: los trabajos están bloqueados por
     * fila, así que dos latidos solapados no se pisan.
     */
    app.get('/tick', manejar);
    app.post('/tick', manejar);
}
/** El token puede ir en cabecera o en la URL: hay servicios que no permiten cabeceras. */
function autorizado(req) {
    const cabecera = req.headers['x-lcrm-cron'];
    const query = req.query?.token;
    const recibido = typeof cabecera === 'string' ? cabecera : query;
    return iguales(recibido, env.cronToken);
}
/** Comparación en tiempo constante, para que el token no se pueda adivinar byte a byte. */
function iguales(a, b) {
    if (typeof a !== 'string' || a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
