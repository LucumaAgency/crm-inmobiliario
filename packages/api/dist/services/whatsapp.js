/**
 * WhatsApp Cloud API: mensajes entrantes y salientes.
 *
 * Entra por el MISMO webhook que Meta Lead Ads (`routes/meta.ts`), porque Meta manda
 * todos los avisos de una app a una sola URL. Lo que cambia es el `object` del cuerpo y
 * la llave de enrutado: `phone_number_id` en vez de `page_id`.
 *
 * Dos reglas del canal que no son detalles de implementación sino de negocio:
 *
 *  - **La ventana de 24 horas.** Desde el último mensaje del cliente se puede responder
 *    texto libre. Pasado ese plazo solo se puede escribir con una plantilla aprobada por
 *    Meta, y esa se paga. Por eso `windowExpiresAt` vive en la tabla y la pantalla lo
 *    muestra: define qué puede hacer el asesor ahora mismo.
 *  - **Un mensaje no es una actividad.** Registrar cada mensaje como actividad del lead
 *    llenaría el historial de ruido y haría inútil la ficha. La conversación es su propio
 *    hilo; al lead solo suben los hechos: entró por un anuncio, volvió a escribir.
 */
import { prisma } from '../db.js';
import { env } from '../env.js';
import { normalizePhonePE } from '@lucuma-crm/shared';
import { descifrar, redactarSecretos } from '../lib/secretos.js';
import { logError, logLine } from '../lib/log.js';
import { enqueue } from '../lib/jobs.js';
import { partirNombre } from '../lib/nombres.js';
import { captureLead } from './capture.js';
const VENTANA_HORAS = 24;
const ESTADOS = {
    sent: 'enviado',
    delivered: 'entregado',
    read: 'leido',
    failed: 'fallido',
};
/**
 * Procesa un bloque `messages` del webhook. Se llama dentro de la petición, como el aviso
 * de leadgen: son escrituras locales, no llamadas de red, y dejar el mensaje en la base
 * antes de responder 200 es lo que garantiza que no se pierde si el proceso muere.
 */
export async function recibirMensajes(valor) {
    const phoneNumberId = valor.metadata?.phone_number_id;
    if (!phoneNumberId) {
        logLine('wa: aviso sin phone_number_id, ignorado');
        return;
    }
    /**
     * Se deja constancia de la LLEGADA, no solo del resultado.
     *
     * Sin esta línea, un aviso descartado y un aviso que nunca llegó se ven igual en el
     * log —vacío— y son dos problemas opuestos: uno está del lado de Meta y el otro del
     * nuestro. Diagnosticarlo costaba mirar el log de accesos de Apache.
     */
    logLine(`wa: aviso recibido de ${phoneNumberId} ` +
        `(${valor.messages?.length ?? 0} mensaje(s), ${valor.statuses?.length ?? 0} estado(s))`);
    const numero = await prisma.waNumber.findUnique({ where: { phoneNumberId } });
    if (!numero || !numero.active) {
        logLine(`wa: aviso de un número no registrado o inactivo (${phoneNumberId})`);
        return;
    }
    for (const estado of valor.statuses ?? []) {
        await aplicarEstado(estado);
    }
    for (const mensaje of valor.messages ?? []) {
        try {
            await recibirUno(numero, valor, mensaje);
        }
        catch (err) {
            logError('wa: no se pudo registrar el mensaje', mensaje.id, err);
        }
    }
}
async function recibirUno(numero, valor, mensaje) {
    const waId = mensaje.from;
    if (!waId || !mensaje.id)
        return;
    // Idempotencia: Meta reintenta el webhook si no recibe el 200 a tiempo.
    const yaEstaba = await prisma.waMessage.findUnique({ where: { waMessageId: mensaje.id } });
    if (yaEstaba) {
        logLine(`wa: mensaje repetido, ignorado (${mensaje.id})`);
        return;
    }
    const perfil = valor.contacts?.find((c) => c.wa_id === waId);
    const { texto, tipo, media } = interpretar(mensaje);
    const recibidoEn = mensaje.timestamp ? new Date(Number(mensaje.timestamp) * 1000) : new Date();
    const conversacion = await conversacionDe(numero, waId, perfil?.profile?.name);
    /**
     * ¿Este mensaje abre un lead?
     *
     * Sí cuando viene de un anuncio (`referral`: es una intención nueva, con su campaña) o
     * cuando la conversación no tiene un lead activo detrás. Si ya lo tiene, el mensaje es
     * parte de la conversación y nada más: crear un lead por mensaje llenaría el embudo de
     * duplicados y repartiría a la misma persona entre varios asesores.
     */
    const leadActivo = conversacion.leadId
        ? await prisma.lead.findFirst({
            where: { id: conversacion.leadId, status: 'activo' },
            select: { id: true },
        })
        : null;
    let leadId = leadActivo?.id ?? null;
    if (mensaje.referral || !leadId) {
        const resultado = await captureLead({
            idempotencyKey: `wa-${mensaje.id}`,
            values: limpiar({
                fname: perfil?.profile?.name ?? 'Contacto de WhatsApp',
                phone: `+${waId}`,
                message: texto,
            }),
            ...(mensaje.referral
                ? {
                    attribution: {
                        last: limpiar({
                            utm_source: 'whatsapp',
                            utm_medium: 'click_to_whatsapp',
                            utm_campaign: mensaje.referral.source_id,
                            meta_ctwa_clid: mensaje.referral.ctwa_clid,
                            anuncio: mensaje.referral.headline,
                            source_url: mensaje.referral.source_url,
                        }),
                    },
                }
                : {}),
        }, null, {
            organizationId: numero.organizationId,
            projectId: numero.projectId,
            source: mensaje.referral ? 'whatsapp_ctwa' : 'whatsapp',
        });
        leadId = resultado.leadId;
    }
    const vence = new Date(recibidoEn.getTime() + VENTANA_HORAS * 60 * 60 * 1000);
    await prisma.$transaction([
        prisma.waMessage.create({
            data: {
                conversationId: conversacion.id,
                direction: 'entrante',
                waMessageId: mensaje.id,
                type: tipo,
                body: texto,
                media: (media ?? undefined),
                status: 'entregado',
                raw: mensaje,
                sentAt: recibidoEn,
            },
        }),
        prisma.waConversation.update({
            where: { id: conversacion.id },
            data: {
                leadId: leadId ?? conversacion.leadId,
                lastInboundAt: recibidoEn,
                windowExpiresAt: vence,
                unread: { increment: 1 },
            },
        }),
        prisma.waNumber.update({
            where: { id: numero.id },
            data: { lastInboundAt: recibidoEn, lastError: null },
        }),
        /**
         * Un mensaje entrante ES actividad del lead, aunque no genere una entrada en el
         * historial (decisión 28).
         *
         * Sin esto, un cliente que escribe sobre un lead que ya existía no movía nada: la
         * lista ordena por actividad reciente y el lead se quedaba donde estaba, enterrado
         * entre los viejos. El mensaje llegaba y nadie lo veía.
         */
        ...(leadId
            ? [
                prisma.lead.update({
                    where: { id: leadId },
                    data: { lastActivityAt: recibidoEn },
                }),
            ]
            : []),
    ]);
    logLine(`wa: mensaje de +${waId} → lead ${leadId ?? 'sin lead'}`);
}
/** Estados de entrega de lo que enviamos nosotros. */
async function aplicarEstado(estado) {
    if (!estado.id || !estado.status)
        return;
    const nuevo = ESTADOS[estado.status];
    if (!nuevo)
        return;
    const mensaje = await prisma.waMessage.findUnique({ where: { waMessageId: estado.id } });
    if (!mensaje)
        return;
    /**
     * Los estados llegan fuera de orden: `read` puede adelantar a `delivered`. Sin este
     * orden, un mensaje ya leído volvería a aparecer como entregado.
     */
    const orden = ['pendiente', 'enviado', 'entregado', 'leido'];
    if (nuevo !== 'fallido' && orden.indexOf(nuevo) <= orden.indexOf(mensaje.status))
        return;
    const error = estado.errors?.[0];
    await prisma.waMessage.update({
        where: { id: mensaje.id },
        data: {
            status: nuevo,
            error: error ? `${error.code ?? ''} ${error.title ?? ''} ${error.message ?? ''}`.trim() : null,
        },
    });
}
/** ¿Se puede escribir texto libre ahora mismo? */
export function ventanaAbierta(conv) {
    return Boolean(conv.windowExpiresAt && conv.windowExpiresAt.getTime() > Date.now());
}
/**
 * Deja el mensaje en la base y encola el envío.
 *
 * El orden importa: primero la fila, después la llamada a Meta. Al revés, un fallo del
 * proceso entre el envío y el guardado dejaría al cliente con un mensaje que el CRM no
 * sabe que mandó, y el asesor lo repetiría.
 */
export async function enviarTexto(datos) {
    const conv = await cargarConversacion(datos.conversationId);
    if (!ventanaAbierta(conv)) {
        throw Object.assign(new Error('La ventana de 24 horas se cerró: solo se puede escribir con una plantilla aprobada.'), { statusCode: 409 });
    }
    return crearYEncolar(conv, {
        userId: datos.userId,
        type: 'text',
        body: datos.text,
    });
}
export async function enviarPlantilla(datos) {
    const conv = await cargarConversacion(datos.conversationId);
    return crearYEncolar(conv, {
        userId: datos.userId,
        type: 'template',
        templateName: datos.templateName,
        body: resumenPlantilla(datos.templateName, datos.variables),
        payload: {
            name: datos.templateName,
            language: datos.language,
            variables: datos.variables ?? [],
        },
    });
}
async function crearYEncolar(conv, datos) {
    const mensaje = await prisma.waMessage.create({
        data: {
            conversationId: conv.id,
            direction: 'saliente',
            type: datos.type,
            body: datos.body,
            templateName: datos.templateName,
            userId: datos.userId,
            status: 'pendiente',
            raw: (datos.payload ?? undefined),
        },
    });
    await enqueue('wa.send', { messageId: mensaje.id });
    return mensaje;
}
/**
 * Envía de verdad. Lo llama la cola.
 *
 * Un 4xx de Meta no se reintenta: el mensaje está mal formado o la plantilla no existe, y
 * repetirlo seis veces solo retrasa que alguien se entere. Los 5xx y los cortes de red sí
 * se propagan para que la cola vuelva a intentarlo.
 */
export async function despacharMensaje(messageId) {
    const mensaje = await prisma.waMessage.findUnique({
        where: { id: messageId },
        include: { conversation: { include: { waNumber: true } } },
    });
    if (!mensaje)
        throw new Error(`wa: no existe el mensaje ${messageId}`);
    if (mensaje.status !== 'pendiente')
        return; // ya salió: la cola reintentó de más
    const numero = mensaje.conversation.waNumber;
    const cuerpo = mensaje.type === 'template'
        ? cuerpoPlantilla(mensaje.conversation.waId, mensaje.raw)
        : {
            messaging_product: 'whatsapp',
            to: mensaje.conversation.waId,
            type: 'text',
            text: { preview_url: true, body: mensaje.body ?? '' },
        };
    try {
        const res = await llamarCloud(`${numero.phoneNumberId}/messages`, descifrar(numero.accessTokenEnc), cuerpo);
        const waMessageId = res.messages?.[0]?.id;
        /**
         * A partir de aquí el mensaje YA salió: el cliente lo tiene en el teléfono.
         *
         * Por eso ningún fallo al anotarlo puede propagarse. Si se propagara, la cola
         * reintentaría el job y el cliente recibiría el mismo mensaje dos veces, que es un
         * error mucho peor que perder el identificador de Meta. En el peor caso queda como
         * enviado sin `waMessageId` —sin estados de entrega— y eso se ve en el log.
         */
        try {
            await prisma.$transaction([
                prisma.waMessage.update({
                    where: { id: mensaje.id },
                    data: { status: 'enviado', waMessageId, sentAt: new Date(), error: null },
                }),
                prisma.waConversation.update({
                    where: { id: mensaje.conversationId },
                    data: { lastOutboundAt: new Date() },
                }),
            ]);
        }
        catch (errAnotar) {
            logError('wa: el mensaje salió pero no se pudo anotar entero', mensaje.id, errAnotar);
            await prisma.waMessage
                .update({ where: { id: mensaje.id }, data: { status: 'enviado', sentAt: new Date() } })
                .catch(() => undefined);
        }
        logLine(`wa: enviado ${mensaje.id} → ${waMessageId ?? 'sin id'}`);
    }
    catch (err) {
        const e = err;
        const detalle = redactarSecretos(e.message);
        await prisma.waMessage.update({
            where: { id: mensaje.id },
            data: { status: 'fallido', error: detalle.slice(0, 1000) },
        });
        await prisma.waNumber.update({
            where: { id: numero.id },
            data: { lastError: detalle.slice(0, 1000) },
        });
        // Un error del propio mensaje no mejora repitiéndolo.
        if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
            logError('wa: envío rechazado por Meta, sin reintento', mensaje.id, e.message);
            return;
        }
        throw err;
    }
}
/** Plantillas aprobadas de la cuenta, para poder escribir fuera de la ventana. */
export async function plantillasDe(phoneNumberId) {
    const numero = await prisma.waNumber.findUnique({ where: { phoneNumberId } });
    if (!numero)
        return { ok: false, error: 'El número no está conectado' };
    try {
        const res = (await llamarCloud(`${numero.wabaId}/message_templates?fields=name,status,language,category,components&limit=100`, descifrar(numero.accessTokenEnc)));
        await prisma.waNumber.update({ where: { id: numero.id }, data: { lastError: null } });
        return { ok: true, templates: res.data ?? [] };
    }
    catch (err) {
        const mensaje = redactarSecretos(err instanceof Error ? err.message : String(err));
        await prisma.waNumber.update({
            where: { id: numero.id },
            data: { lastError: mensaje.slice(0, 1000) },
        });
        return { ok: false, error: mensaje };
    }
}
// ---------------------------------------------------------------------------
async function cargarConversacion(id) {
    const conv = await prisma.waConversation.findUnique({ where: { id } });
    if (!conv)
        throw Object.assign(new Error('Conversación no encontrada'), { statusCode: 404 });
    return conv;
}
/**
 * Conversación del contacto con este número, creándola si hace falta.
 *
 * El contacto se busca por teléfono normalizado, la misma llave que usa `captureLead`:
 * quien escribió por el formulario web y después por WhatsApp tiene que ser una sola
 * persona en el CRM, no dos.
 */
async function conversacionDe(numero, waId, nombre) {
    const existente = await prisma.waConversation.findUnique({
        where: { waNumberId_waId: { waNumberId: numero.id, waId } },
    });
    if (existente)
        return existente;
    const telefono = normalizePhonePE(`+${waId}`) ?? `+${waId}`;
    let contacto = await prisma.contact.findFirst({
        where: { organizationId: numero.organizationId, phone: telefono },
    });
    if (!contacto) {
        const { fname, lname } = partirNombre(nombre ?? '');
        contacto = await prisma.contact.create({
            data: {
                organizationId: numero.organizationId,
                fname: fname || 'Contacto de WhatsApp',
                lname: lname ?? null,
                phone: telefono,
            },
        });
    }
    try {
        return await prisma.waConversation.create({
            data: {
                organizationId: numero.organizationId,
                waNumberId: numero.id,
                contactId: contacto.id,
                waId,
            },
        });
    }
    catch (err) {
        // Dos mensajes seguidos del mismo desconocido llegan casi a la vez.
        if (err.code === 'P2002') {
            const ganadora = await prisma.waConversation.findUnique({
                where: { waNumberId_waId: { waNumberId: numero.id, waId } },
            });
            if (ganadora)
                return ganadora;
        }
        throw err;
    }
}
/** Texto y tipo de un mensaje entrante. Lo que no es texto se anota, no se descarga. */
function interpretar(m) {
    const tipo = m.type ?? 'text';
    switch (tipo) {
        case 'text':
            return { texto: m.text?.body, tipo, media: null };
        case 'button':
            return { texto: m.button?.text, tipo, media: null };
        case 'interactive':
            return {
                texto: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title,
                tipo,
                media: null,
            };
        case 'image':
            return { texto: m.image?.caption, tipo, media: { id: m.image?.id, mime: m.image?.mime_type } };
        case 'video':
            return { texto: m.video?.caption, tipo, media: { id: m.video?.id, mime: m.video?.mime_type } };
        case 'document':
            return {
                texto: m.document?.caption ?? m.document?.filename,
                tipo,
                media: { id: m.document?.id, mime: m.document?.mime_type, filename: m.document?.filename },
            };
        case 'audio':
            return { texto: undefined, tipo, media: { id: m.audio?.id, mime: m.audio?.mime_type } };
        case 'location':
            return {
                texto: m.location?.name,
                tipo,
                media: { lat: m.location?.latitude, lng: m.location?.longitude },
            };
        default:
            // Sticker, contacto, reacción... El asesor ve que llegó algo y lo abre en el móvil.
            return { texto: undefined, tipo: 'unsupported', media: null };
    }
}
function cuerpoPlantilla(waId, payload) {
    const nombre = String(payload?.name ?? '');
    const idioma = String(payload?.language ?? 'es');
    const variables = Array.isArray(payload?.variables) ? payload.variables : [];
    return {
        messaging_product: 'whatsapp',
        to: waId,
        type: 'template',
        template: {
            name: nombre,
            language: { code: idioma },
            ...(variables.length
                ? {
                    components: [
                        {
                            type: 'body',
                            parameters: variables.map((v) => ({ type: 'text', text: v })),
                        },
                    ],
                }
                : {}),
        },
    };
}
/** Lo que se guarda como cuerpo de una plantilla, para que la ficha no salga vacía. */
function resumenPlantilla(nombre, variables) {
    const v = (variables ?? []).filter(Boolean);
    return v.length ? `[plantilla ${nombre}] ${v.join(' · ')}` : `[plantilla ${nombre}]`;
}
async function llamarCloud(ruta, token, cuerpo) {
    const url = `https://graph.facebook.com/${env.meta.graphVersion}/${ruta}`;
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 15_000);
    try {
        const res = await fetch(url, {
            method: cuerpo ? 'POST' : 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
            signal: control.signal,
        });
        const datos = (await res.json().catch(() => ({})));
        if (!res.ok || datos.error) {
            const e = datos.error;
            throw Object.assign(new Error(`Cloud API ${res.status}: ${e?.message ?? 'sin detalle'}${e?.error_data?.details ? ` — ${e.error_data.details}` : ''}`), { statusCode: res.status });
        }
        return datos;
    }
    finally {
        clearTimeout(corte);
    }
}
function limpiar(o) {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && v !== ''));
}
