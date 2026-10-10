/**
 * Webhook de Meta: Lead Ads y WhatsApp.
 *
 * Es el único punto del CRM que acepta escrituras sin sesión y sin llave de sitio, así
 * que la firma es lo que sostiene todo:
 *
 *  - `GET  /api/v1/meta/webhook` — el apretón de manos del alta. Meta llama una vez con
 *    `hub.verify_token` y espera de vuelta `hub.challenge` en texto plano.
 *  - `POST /api/v1/meta/webhook` — los avisos. Se comprueba `X-Hub-Signature-256` contra
 *    el cuerpo CRUDO antes de mirar nada más.
 *
 * La URL es una sola para toda la aplicación: Meta no admite una por cliente, y **tampoco
 * una por producto**. Por aquí entran los formularios instantáneos (`object: "page"`) y
 * los mensajes de WhatsApp (`object: "whatsapp_business_account"`), que comparten app y
 * por tanto app secret. La organización sale del identificador que trae el aviso —
 * `page_id` o `phone_number_id`—, nunca del subdominio.
 */
import crypto from 'node:crypto';
import { env } from '../env.js';
import { logError, logLine } from '../lib/log.js';
import { registrarAviso } from '../services/meta.js';
import { recibirMensajes } from '../services/whatsapp.js';
export default async function metaRoutes(app) {
    /**
     * Meta firma los bytes que envió, no el JSON re-serializado.
     *
     * `JSON.parse` seguido de `JSON.stringify` no devuelve el mismo texto (espacios, orden
     * de claves, escapes de acentos), así que calcular la firma sobre el objeto ya parseado
     * la haría fallar de forma intermitente y aparentemente inexplicable. El parser se
     * registra dentro de este plugin, así que no afecta al resto de la API.
     */
    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
        req.rawBody = body;
        try {
            done(null, body === '' ? {} : JSON.parse(body));
        }
        catch (err) {
            done(err, undefined);
        }
    });
    /** Alta de la suscripción. */
    app.get('/webhook', async (req, reply) => {
        if (!env.meta.verifyToken) {
            logError('meta: alta del webhook rechazada, falta META_VERIFY_TOKEN');
            return reply.code(503).send({ error: 'Integración de Meta no configurada' });
        }
        const q = req.query;
        if (q['hub.mode'] === 'subscribe' && seguroIguales(q['hub.verify_token'], env.meta.verifyToken)) {
            logLine('meta: webhook verificado por Meta');
            // Texto plano y tal cual: Meta compara la respuesta carácter a carácter.
            return reply.type('text/plain').send(q['hub.challenge'] ?? '');
        }
        logError('meta: intento de alta con verify_token incorrecto');
        return reply.code(403).send({ error: 'Token de verificación incorrecto' });
    });
    /** Avisos de lead nuevo. */
    app.post('/webhook', async (req, reply) => {
        if (!env.meta.appSecret) {
            logError('meta: aviso recibido con META_APP_SECRET sin configurar, descartado');
            return reply.code(503).send({ error: 'Integración de Meta no configurada' });
        }
        if (!firmaValida(req)) {
            logError('meta: aviso con firma inválida, descartado');
            return reply.code(401).send({ error: 'Firma inválida' });
        }
        const cuerpo = req.body ?? {};
        /**
         * WhatsApp. Se procesa en la petición, igual que el aviso de leadgen y por el mismo
         * motivo: son escrituras locales, y el mensaje tiene que estar en la base antes de
         * responder 200 para que no se pierda si el proceso muere justo después.
         */
        if (cuerpo.object === 'whatsapp_business_account') {
            for (const entrada of cuerpo.entry ?? []) {
                for (const cambio of entrada.changes ?? []) {
                    if (cambio.field !== 'messages' || !cambio.value)
                        continue;
                    try {
                        await recibirMensajes(cambio.value);
                    }
                    catch (err) {
                        logError('wa: no se pudo procesar el aviso', err);
                    }
                }
            }
            return { received: true };
        }
        if (cuerpo.object !== 'page')
            return { received: true };
        const avisos = [];
        for (const entrada of cuerpo.entry ?? []) {
            for (const cambio of entrada.changes ?? []) {
                if (cambio.field !== 'leadgen')
                    continue;
                const v = cambio.value ?? {};
                if (!v.leadgen_id || !v.page_id)
                    continue;
                avisos.push({
                    leadgenId: String(v.leadgen_id),
                    pageId: String(v.page_id),
                    formId: v.form_id ? String(v.form_id) : undefined,
                    adId: v.ad_id ? String(v.ad_id) : undefined,
                    adgroupId: v.adgroup_id ? String(v.adgroup_id) : undefined,
                    createdTime: v.created_time,
                });
            }
        }
        /**
         * Se registran los avisos AQUÍ, dentro de la petición, y no en la cola.
         *
         * Parece contradecir la regla de responder rápido, pero es un INSERT por aviso, no
         * una llamada de red: lo caro es el Graph API, y eso sí queda encolado. A cambio, si
         * el proceso muere justo después del 200, el aviso ya está en la base y no se pierde;
         * anotarlo en una cola en memoria y responder antes sería exactamente el fallo que
         * este CRM existe para no tener.
         *
         * Un fallo al registrar no se le devuelve a Meta como error: repetido, Meta desactiva
         * la suscripción de la aplicación, y eso dejaría sin leads a todos los clientes a la
         * vez. Queda en el log.
         */
        for (const aviso of avisos) {
            try {
                await registrarAviso(aviso);
            }
            catch (err) {
                logError('meta: no se pudo registrar el aviso', aviso.leadgenId, err);
            }
        }
        return { received: true };
    });
}
/** HMAC-SHA256 del cuerpo crudo con el app secret, comparado en tiempo constante. */
function firmaValida(req) {
    const cabecera = req.headers['x-hub-signature-256'];
    if (typeof cabecera !== 'string' || !cabecera.startsWith('sha256='))
        return false;
    if (typeof req.rawBody !== 'string')
        return false;
    const esperada = crypto
        .createHmac('sha256', env.meta.appSecret)
        .update(req.rawBody, 'utf8')
        .digest('hex');
    return seguroIguales(cabecera.slice('sha256='.length), esperada);
}
/**
 * Comparación en tiempo constante.
 *
 * Con `===`, el tiempo de respuesta depende de cuántos caracteres coinciden desde el
 * principio, y eso deja adivinar la firma byte a byte. `timingSafeEqual` exige además
 * longitudes iguales, de ahí la comprobación previa.
 */
function seguroIguales(a, b) {
    if (typeof a !== 'string' || a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
