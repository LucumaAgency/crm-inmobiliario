/**
 * Webhooks propios de la coexistencia (número en la app WhatsApp Business + en la API).
 *
 *  - `smb_message_echoes`: lo que el asesor escribió desde el teléfono. Se guarda como
 *    saliente con `via: telefono`. `from` es el número de la empresa y `to` el cliente:
 *    al revés que en `messages`.
 *  - `history`: los chats de hasta 180 días atrás, por fases y en trozos. Decisión 2 de
 *    docs/27 §5: el historial NO abre leads; solo se cuelga de contactos que ya tienen
 *    lead en la organización. El resto se descarta.
 *  - `smb_app_state_sync`: los contactos del teléfono. Solo completan el nombre de un
 *    contacto que todavía tiene el nombre genérico; nunca crean contactos.
 *  - `account_update`: avisos de la cuenta. `PARTNER_REMOVED` (el asesor desconectó, o
 *    Meta lo hizo por 14 días sin abrir la app) apaga el número y avisa al gerente.
 *
 * Igual que `messages`, se procesan dentro de la petición del webhook: son escrituras
 * locales y Meta no reenvía un aviso respondido con 200.
 */
import { normalizePhonePE } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { logError, logLine } from '../lib/log.js';
import { enqueue } from '../lib/jobs.js';
import { partirNombre } from '../lib/nombres.js';
import { conversacionDe, interpretar } from './whatsapp.js';
/** Nombres que pone el CRM cuando no sabe cómo se llama alguien. */
const NOMBRES_GENERICOS = new Set(['Contacto de WhatsApp', 'Sin nombre']);
const ESTADO_HISTORIAL = {
    PENDING: 'pendiente',
    SENT: 'enviado',
    DELIVERED: 'entregado',
    READ: 'leido',
    PLAYED: 'leido',
    ERROR: 'fallido',
};
async function numeroDe(metadata) {
    const id = metadata?.phone_number_id;
    if (!id)
        return null;
    const n = await prisma.waNumber.findUnique({ where: { phoneNumberId: id } });
    if (!n || !n.active) {
        logLine(`wa: aviso de coexistencia de un número no registrado o inactivo (${id})`);
        return null;
    }
    return n;
}
/** Lead más reciente del contacto (activo primero), para colgar la conversación. */
async function leadDelContacto(organizationId, contactId) {
    return ((await prisma.lead.findFirst({
        where: { organizationId, contactId, status: 'activo' },
        orderBy: { createdAt: 'desc' },
        select: { id: true, firstContactAt: true },
    })) ??
        (await prisma.lead.findFirst({
            where: { organizationId, contactId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, firstContactAt: true },
        })));
}
// ------------------------------------------------------------- ecos
export async function recibirEcos(valor) {
    const numero = await numeroDe(valor.metadata);
    if (!numero)
        return;
    logLine(`wa: ${valor.message_echoes?.length ?? 0} eco(s) del teléfono en ${numero.phoneNumberId}`);
    for (const eco of valor.message_echoes ?? []) {
        try {
            await recibirEco(numero, eco);
        }
        catch (err) {
            logError('wa: no se pudo registrar el eco', eco.id, err);
        }
    }
}
async function recibirEco(numero, eco) {
    if (!eco.id)
        return;
    if (await prisma.waMessage.findUnique({ where: { waMessageId: eco.id } }))
        return;
    // Borrar o editar desde el teléfono cambia el mensaje original, no agrega uno nuevo.
    if (eco.type === 'revoke' || eco.type === 'edit') {
        const originalId = eco.revoke?.original_message_id ?? eco.edit?.original_message_id;
        const original = originalId ? await prisma.waMessage.findUnique({ where: { waMessageId: originalId } }) : null;
        if (!original) {
            logLine(`wa: ${eco.type} de un mensaje que el CRM no tiene (${originalId ?? '?'}), ignorado`);
            return;
        }
        if (eco.type === 'revoke') {
            await prisma.waMessage.update({
                where: { id: original.id },
                data: { body: '🚫 Mensaje eliminado desde el teléfono', media: { original: 'revocado' } },
            });
        }
        else if (eco.edit?.message) {
            const { texto, tipo, media } = interpretar(eco.edit.message);
            await prisma.waMessage.update({
                where: { id: original.id },
                data: {
                    body: `${texto ?? ''} (editado)`.trim(),
                    type: tipo,
                    ...(media ? { media: media } : {}),
                },
            });
        }
        return;
    }
    const waId = eco.to ?? eco.to_user_id;
    if (!waId) {
        logLine(`wa: eco sin destinatario, ignorado (${eco.id})`);
        return;
    }
    const conversacion = await conversacionDe(numero, waId, Boolean(eco.to));
    const lead = conversacion.leadId
        ? await prisma.lead.findUnique({ where: { id: conversacion.leadId }, select: { id: true, firstContactAt: true } })
        : await leadDelContacto(numero.organizationId, conversacion.contactId);
    const { texto, tipo, media } = interpretar(eco);
    const enviadoEn = eco.timestamp ? new Date(Number(eco.timestamp) * 1000) : new Date();
    const creado = await prisma.waMessage.create({
        data: {
            conversationId: conversacion.id,
            direction: 'saliente',
            waMessageId: eco.id,
            type: tipo,
            body: texto,
            media: (media ?? undefined),
            status: 'enviado',
            via: 'telefono',
            // El número es del asesor: lo que sale del teléfono lo escribió él.
            userId: numero.ownerUserId,
            raw: eco,
            sentAt: enviadoEn,
        },
    });
    await prisma.$transaction([
        prisma.waConversation.update({
            where: { id: conversacion.id },
            data: {
                lastOutboundAt: enviadoEn,
                // Si el asesor respondió desde el teléfono, ya leyó lo pendiente.
                unread: 0,
                ...(lead && !conversacion.leadId ? { leadId: lead.id } : {}),
            },
        }),
        // Responder desde el teléfono es contacto real: cuenta para el SLA.
        ...(lead
            ? [
                prisma.lead.update({
                    where: { id: lead.id },
                    data: { lastActivityAt: enviadoEn, ...(lead.firstContactAt ? {} : { firstContactAt: enviadoEn }) },
                }),
            ]
            : []),
    ]);
    if (media && typeof media.id === 'string' && media.id) {
        await enqueue('wa.media.fetch', { messageId: creado.id });
    }
}
// ---------------------------------------------------------- historial
export async function recibirHistorial(valor) {
    const numero = await numeroDe(valor.metadata);
    if (!numero)
        return;
    // Contenido de archivos que llega después del mensaje de historial.
    for (const m of valor.messages ?? []) {
        if (!m.id)
            continue;
        const { media } = interpretar(m);
        const existente = await prisma.waMessage.findUnique({ where: { waMessageId: m.id } });
        if (!existente || !media || typeof media.id !== 'string')
            continue;
        await prisma.waMessage.update({
            where: { id: existente.id },
            data: { type: m.type ?? existente.type, media: media },
        });
        await enqueue('wa.media.fetch', { messageId: existente.id });
    }
    for (const bloque of valor.history ?? []) {
        const error = bloque.errors?.[0];
        if (error) {
            const rechazado = error.code === 2593109;
            await prisma.waNumber.update({
                where: { id: numero.id },
                data: {
                    historialEstado: rechazado ? 'rechazado' : numero.historialEstado,
                    syncError: rechazado
                        ? 'El asesor no aceptó compartir el historial en la app. Los chats nuevos sí entran.'
                        : `Historial: ${error.message ?? error.title ?? `error ${error.code}`}`,
                },
            });
            logLine(`wa: historial de ${numero.phoneNumberId} con error ${error.code}`);
            continue;
        }
        let importados = 0;
        let descartados = 0;
        for (const hilo of bloque.threads ?? []) {
            const r = await importarHilo(numero, hilo);
            importados += r.importados;
            descartados += r.descartado ? 1 : 0;
        }
        const progreso = bloque.metadata?.progress;
        await prisma.waNumber.update({
            where: { id: numero.id },
            data: {
                ...(typeof progreso === 'number'
                    ? { historialProgreso: progreso, historialEstado: progreso >= 100 ? 'completo' : 'en_curso' }
                    : {}),
            },
        });
        logLine(`wa: historial de ${numero.phoneNumberId} fase ${bloque.metadata?.phase ?? '?'} trozo ` +
            `${bloque.metadata?.chunk_order ?? '?'} (${progreso ?? '?'}%): ${importados} mensaje(s), ` +
            `${descartados} chat(s) sin lead descartados`);
    }
}
async function importarHilo(numero, hilo) {
    const waId = hilo.context?.wa_id ?? hilo.id ?? hilo.context?.user_id;
    if (!waId)
        return { importados: 0, descartado: true };
    const conNumero = /^\d+$/.test(waId);
    // Solo chats de contactos que ya son leads (decisión 2, docs/27 §5).
    let contactId = null;
    const yaConversacion = await prisma.waConversation.findUnique({
        where: { waNumberId_waId: { waNumberId: numero.id, waId } },
        select: { contactId: true },
    });
    if (yaConversacion) {
        contactId = yaConversacion.contactId;
    }
    else if (conNumero) {
        const telefono = normalizePhonePE(`+${waId}`) ?? `+${waId}`;
        const c = await prisma.contact.findFirst({
            where: { organizationId: numero.organizationId, phone: telefono },
            select: { id: true },
        });
        contactId = c?.id ?? null;
    }
    const lead = contactId ? await leadDelContacto(numero.organizationId, contactId) : null;
    if (!lead)
        return { importados: 0, descartado: true };
    const conversacion = await conversacionDe(numero, waId, conNumero);
    const filas = (hilo.messages ?? [])
        .filter((m) => m.id)
        .map((m) => {
        const entrante = m.from === waId || (hilo.context?.user_id && m.from === hilo.context.user_id);
        const { texto, tipo, media } = m.type === 'media_placeholder'
            ? { texto: '📎 Archivo del historial (solo se traen los de los últimos 14 días)', tipo: 'unsupported', media: null }
            : interpretar(m);
        return {
            conversationId: conversacion.id,
            direction: entrante ? 'entrante' : 'saliente',
            waMessageId: m.id,
            type: tipo,
            body: texto,
            media: (media ?? undefined),
            status: ESTADO_HISTORIAL[m.history_context?.status ?? ''] ?? (entrante ? 'entregado' : 'enviado'),
            via: 'historial',
            userId: entrante ? null : numero.ownerUserId,
            raw: m,
            sentAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : null,
            // La ficha ordena por `createdAt`: un mensaje de hace tres meses importado hoy tiene
            // que quedar en su lugar, no al final del chat.
            createdAt: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
        };
    });
    // `skipDuplicates`: el mismo trozo puede llegar dos veces y algunos mensajes ya
    // entraron por el webhook normal mientras corría la sincronización.
    const r = filas.length ? await prisma.waMessage.createMany({ data: filas, skipDuplicates: true }) : { count: 0 };
    const ultimaEntrante = Math.max(0, ...filas.filter((f) => f.direction === 'entrante').map((f) => f.sentAt?.getTime() ?? 0));
    const ultimaSaliente = Math.max(0, ...filas.filter((f) => f.direction === 'saliente').map((f) => f.sentAt?.getTime() ?? 0));
    await prisma.waConversation.update({
        where: { id: conversacion.id },
        data: {
            ...(conversacion.leadId ? {} : { leadId: lead.id }),
            // Solo se adelantan las marcas; el historial no abre la ventana de 24 h ni suma no leídos.
            ...(ultimaEntrante && (!conversacion.lastInboundAt || conversacion.lastInboundAt.getTime() < ultimaEntrante)
                ? { lastInboundAt: new Date(ultimaEntrante) }
                : {}),
            ...(ultimaSaliente && (!conversacion.lastOutboundAt || conversacion.lastOutboundAt.getTime() < ultimaSaliente)
                ? { lastOutboundAt: new Date(ultimaSaliente) }
                : {}),
        },
    });
    return { importados: r.count, descartado: false };
}
// ---------------------------------------------------------- contactos
export async function recibirContactos(valor) {
    const numero = await numeroDe(valor.metadata);
    if (!numero)
        return;
    let completados = 0;
    for (const s of valor.state_sync ?? []) {
        if (s.type !== 'contact' || s.action !== 'add' || !s.contact?.full_name)
            continue;
        const c = s.contact;
        let contacto = null;
        if (c.phone_number) {
            const telefono = normalizePhonePE(`+${c.phone_number.replace(/^\+/, '')}`) ?? `+${c.phone_number}`;
            contacto = await prisma.contact.findFirst({ where: { organizationId: numero.organizationId, phone: telefono } });
        }
        if (!contacto && c.user_id) {
            const conv = await prisma.waConversation.findUnique({
                where: { waNumberId_waId: { waNumberId: numero.id, waId: c.user_id } },
                include: { contact: true },
            });
            contacto = conv?.contact ?? null;
        }
        // Nunca se pisa un nombre que alguien escribió en el CRM.
        if (!contacto || !NOMBRES_GENERICOS.has(contacto.fname))
            continue;
        const { fname, lname } = partirNombre(c.full_name ?? '');
        if (!fname)
            continue;
        await prisma.contact.update({ where: { id: contacto.id }, data: { fname, lname: lname ?? contacto.lname } });
        completados++;
    }
    logLine(`wa: ${valor.state_sync?.length ?? 0} contacto(s) del teléfono en ${numero.phoneNumberId}, ` +
        `${completados} nombre(s) completado(s)`);
}
// ------------------------------------------------------------ cuenta
const MOTIVOS = {
    ACCOUNT_DISCONNECTED: 'el número se desconectó desde la app WhatsApp Business',
    BUSINESS_DOWNGRADE: 'el número pasó a WhatsApp normal (no Business)',
    CHANGE_NUMBER: 'el número cambió',
    COMPANION_INACTIVITY: 'unos 30 días sin actividad en los dispositivos vinculados',
    PRIMARY_INACTIVITY: 'no se abrió WhatsApp en el teléfono durante unos 14 días',
    USER_RE_REGISTERED: 'el número se volvió a registrar en otro teléfono',
};
/**
 * Texto con el que se apaga un número por cambio de teléfono. Es la marca que permite
 * reactivarlo solo cuando llega `ACCOUNT_RECONNECTED`: un número apagado por
 * `PARTNER_REMOVED` perdió el acceso de la app y solo vuelve con un alta nueva.
 */
const DESCONECTADO_POR_DISPOSITIVO = 'El número se desconectó (cambio de teléfono o nuevo registro).';
/** `wabaIdEntrada` es el `entry.id` del aviso: la WABA, cuando el evento no trae `waba_info`. */
export async function recibirCuenta(wabaIdEntrada, valor) {
    const evento = valor.event ?? '?';
    const wabaId = valor.waba_info?.waba_id ?? wabaIdEntrada;
    logLine(`wa: account_update ${evento} de la cuenta ${wabaId ?? '?'}`);
    if (!wabaId)
        return;
    const numeros = await prisma.waNumber.findMany({ where: { wabaId } });
    if (!numeros.length)
        return;
    if (evento === 'PARTNER_REMOVED' || evento === 'ACCOUNT_DELETED' || evento === 'ACCOUNT_OFFBOARDED') {
        const motivo = valor.disconnection_info?.reason;
        const detalle = evento === 'PARTNER_REMOVED'
            ? `Meta quitó el acceso del CRM a esta cuenta${motivo ? `: ${MOTIVOS[motivo] ?? motivo}` : ''}.`
            : evento === 'ACCOUNT_DELETED'
                ? 'La cuenta de WhatsApp se eliminó en Meta.'
                : DESCONECTADO_POR_DISPOSITIVO;
        for (const n of numeros) {
            if (!n.active)
                continue;
            await prisma.waNumber.update({
                where: { id: n.id },
                data: { active: false, lastError: `${detalle} Para volver a recibir chats, repite «Conectar WhatsApp».` },
            });
            await enqueue('email.send', { kind: 'wa_desconectado', waNumberId: n.id, detalle });
        }
        return;
    }
    if (evento === 'ACCOUNT_RECONNECTED') {
        for (const n of numeros) {
            if (n.active || !n.coexistencia || !n.lastError?.startsWith(DESCONECTADO_POR_DISPOSITIVO))
                continue;
            await prisma.waNumber.update({ where: { id: n.id }, data: { active: true, lastError: null } });
        }
    }
}
