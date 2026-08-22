import { Prisma } from '@prisma/client';
import { normalizeDocument, normalizeEmail, normalizePhonePE, } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { enqueue } from '../lib/jobs.js';
import { assignLead, pickOwner } from './assign.js';
import { env } from '../env.js';
const VENTANA_DEDUP_DIAS = 30;
/**
 * Puerta única de entrada de leads. Toda fuente (formulario web, WhatsApp, Meta Ads,
 * importación, alta manual) termina aquí.
 */
export async function captureLead(input, schema, ctx) {
    // 1) Idempotencia. El reintento de la cola del plugin trae la misma clave.
    if (ctx.formId) {
        const previa = await prisma.formSubmission.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { leadId: true, isSpam: true },
        });
        if (previa) {
            return { leadId: previa.leadId ?? '', duplicated: true, isSpam: previa.isSpam };
        }
    }
    // 2) Interpretar los valores usando el "semantic" de cada campo. Aquí no hay mapeo
    //    manual: el CRM definió el formulario, así que sabe qué es cada cosa.
    const campos = interpretar(input.values, schema);
    const spam = detectarSpam(input, schema);
    const email = normalizeEmail(campos.email);
    const phone = normalizePhonePE(campos.phone);
    const document = normalizeDocument(campos.document);
    // 3) Contacto: identidad por documento → email → teléfono.
    const contacto = await upsertContacto(ctx.organizationId, {
        fname: campos.fname || 'Sin nombre',
        lname: campos.lname,
        email,
        phone,
        document,
    });
    // 4) Lead: ¿ya existe uno abierto del mismo contacto en el mismo proyecto?
    const projectId = ctx.projectId ?? campos.projectId ?? null;
    const desde = new Date(Date.now() - VENTANA_DEDUP_DIAS * 24 * 60 * 60 * 1000);
    const existente = await prisma.lead.findFirst({
        where: {
            organizationId: ctx.organizationId,
            contactId: contacto.id,
            projectId,
            status: 'activo',
            createdAt: { gte: desde },
        },
        orderBy: { createdAt: 'desc' },
    });
    const unidad = await resolverUnidad(campos.unitInterest, projectId);
    const unitId = unidad?.id ?? null;
    const ahora = new Date();
    let leadId;
    let duplicado = false;
    if (existente) {
        // Mismo contacto + mismo proyecto dentro de la ventana: es una actividad nueva
        // sobre el lead existente, no un lead nuevo. No se pisa el historial.
        duplicado = true;
        leadId = existente.id;
        // `lead.unitId` guarda la última unidad consultada, así que la anterior se pierde de
        // la ficha. Quien pregunta por dos unidades del mismo proyecto está comparando, y
        // cuáles son es justamente el insumo de la llamada del asesor: queda en el historial.
        const cambioDeUnidad = Boolean(unidad && existente.unitId && unidad.id !== existente.unitId);
        const detalle = [
            unidad ? `unidad ${unidad.code}` : null,
            campos.message ? `«${campos.message}»` : null,
        ].filter(Boolean).join(' · ');
        await prisma.$transaction([
            prisma.lead.update({
                where: { id: leadId },
                data: {
                    lastActivityAt: ahora,
                    unitId: unitId ?? existente.unitId,
                    message: campos.message ?? existente.message,
                },
            }),
            prisma.activity.create({
                data: {
                    leadId,
                    type: 'sistema',
                    body: `Volvió a escribir desde el formulario${detalle ? `: ${detalle}` : ''}`,
                    meta: {
                        source: ctx.source ?? 'web_form',
                        unitId: unidad?.id ?? null,
                        unitCode: unidad?.code ?? null,
                        // Marca para la ficha: consultó por una unidad distinta a la que ya tenía.
                        unitChangedFrom: cambioDeUnidad ? existente.unitId : null,
                    },
                },
            }),
        ]);
    }
    else {
        const etapaInicial = await prisma.stage.findFirst({
            where: { organizationId: ctx.organizationId },
            orderBy: { position: 'asc' },
        });
        const lead = await prisma.lead.create({
            data: {
                organizationId: ctx.organizationId,
                contactId: contacto.id,
                projectId,
                unitId,
                stageId: etapaInicial?.id,
                status: spam ? 'spam' : 'activo',
                source: ctx.source ?? 'web_form',
                message: campos.message,
                attribution: (input.attribution ?? {}),
                consent: (input.consent ?? {}),
                lastActivityAt: ahora,
            },
        });
        leadId = lead.id;
        if (!spam) {
            const owner = await pickOwner(ctx.organizationId);
            if (owner)
                await assignLead(leadId, owner, 'round_robin');
            // SLA de primer contacto: se revisa a los 15 minutos.
            await enqueue('sla.check', { leadId }, new Date(Date.now() + 15 * 60 * 1000));
        }
    }
    // 5) Guardar el envío crudo. Si el mapeo cambia o falla, el original sobrevive.
    if (ctx.formId) {
        await prisma.formSubmission.create({
            data: {
                formId: ctx.formId,
                siteId: ctx.siteId ?? undefined,
                leadId,
                idempotencyKey: input.idempotencyKey,
                formVersion: ctx.formVersion ?? 1,
                rawPayload: input,
                ip: ctx.ip,
                userAgent: ctx.userAgent,
                isSpam: Boolean(spam),
                spamReason: spam || undefined,
            },
        });
    }
    // 6) Notificar. El email va siempre; el plugin además manda el suyo de respaldo.
    if (!spam) {
        await enqueue('email.send', {
            kind: 'new_lead',
            leadId,
            to: ctx.notifyEmails ?? [],
        });
    }
    return { leadId, duplicated: duplicado, isSpam: Boolean(spam) };
}
function interpretar(values, schema) {
    const out = { custom: {} };
    const texto = (v) => (v === null || v === undefined ? undefined : String(v).trim() || undefined);
    if (!schema) {
        // Alta manual o importación: las claves ya vienen con nombre semántico.
        out.fname = texto(values.fname);
        out.lname = texto(values.lname);
        out.email = texto(values.email);
        out.phone = texto(values.phone);
        out.document = texto(values.document);
        out.message = texto(values.message);
        out.unitInterest = texto(values.unit_interest);
        return out;
    }
    for (const field of schema.fields) {
        const valor = texto(values[field.key]);
        if (valor === undefined)
            continue;
        switch (field.semantic) {
            case 'fname':
                out.fname = valor;
                break;
            case 'lname':
                out.lname = valor;
                break;
            case 'email':
                out.email = valor;
                break;
            case 'phone':
                out.phone = valor;
                break;
            case 'document':
                out.document = valor;
                break;
            case 'message':
                out.message = valor;
                break;
            case 'unit_interest':
                out.unitInterest = valor;
                break;
            case 'project_interest':
                out.projectId = valor;
                break;
            default: out.custom[field.key] = valor;
        }
    }
    // Los campos personalizados se anexan al mensaje para que el asesor los vea sin
    // tener que abrir el payload crudo.
    const extras = Object.entries(out.custom);
    if (extras.length) {
        const linea = extras.map(([k, v]) => `${etiqueta(schema, k)}: ${v}`).join(' | ');
        out.message = out.message ? `${out.message}\n\n${linea}` : linea;
    }
    return out;
}
function etiqueta(schema, key) {
    return schema.fields.find((f) => f.key === key)?.label ?? key;
}
/** Devuelve el motivo del spam, o null si parece legítimo. Se marca, no se descarta. */
function detectarSpam(input, schema) {
    const a = input.antispam;
    if (a?.honeypot)
        return 'honeypot';
    const min = schema?.antispam?.minSeconds ?? 3;
    if (a?.elapsedSeconds !== undefined && a.elapsedSeconds < min)
        return 'time_trap';
    return null;
}
/** Busca por documento → email → teléfono. Null nunca identifica a nadie. */
async function buscarContacto(organizationId, d) {
    const claves = [];
    if (d.document)
        claves.push({ document: d.document });
    if (d.email)
        claves.push({ email: d.email });
    if (d.phone)
        claves.push({ phone: d.phone });
    if (!claves.length)
        return null;
    return prisma.contact.findFirst({ where: { organizationId, OR: claves } });
}
/**
 * Identidad del contacto.
 *
 * El `findFirst` seguido de `create` es una condición de carrera: dos envíos simultáneos
 * de la misma persona (doble clic con conexión lenta) buscan a la vez, ninguno encuentra
 * nada y ambos crean. Los índices únicos de `Contact` hacen que MariaDB rechace el segundo
 * con P2002; aquí se traduce esa colisión en "otro proceso ya lo creó" y se reintenta la
 * búsqueda, que es el resultado correcto. La idempotencia no cubre este caso: son dos
 * envíos distintos, con claves distintas.
 */
async function upsertContacto(organizationId, d) {
    const existente = await buscarContacto(organizationId, d);
    if (existente) {
        // Completa lo que falte, sin pisar lo que ya había.
        return prisma.contact.update({
            where: { id: existente.id },
            data: {
                fname: existente.fname === 'Sin nombre' ? d.fname : existente.fname,
                lname: existente.lname ?? d.lname,
                email: existente.email ?? d.email,
                phone: existente.phone ?? d.phone,
                document: existente.document ?? d.document,
            },
        });
    }
    try {
        return await prisma.contact.create({
            data: {
                organizationId,
                fname: d.fname,
                lname: d.lname,
                email: d.email,
                phone: d.phone,
                document: d.document,
            },
        });
    }
    catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            const ganador = await buscarContacto(organizationId, d);
            if (ganador)
                return ganador;
        }
        throw err;
    }
}
/** El value del select puede ser el id de la unidad o su código ("601"). */
async function resolverUnidad(valor, projectId) {
    if (!valor || !projectId)
        return null;
    return prisma.unit.findFirst({
        where: { projectId, OR: [{ id: valor }, { code: valor }] },
        select: { id: true, code: true },
    });
}
export function leadUrl(leadId) {
    return `${env.appUrl.replace(/\/$/, '')}/leads/${leadId}`;
}
