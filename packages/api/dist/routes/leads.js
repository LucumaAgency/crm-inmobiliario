import { activityInput, leadListQuery, seguimientoInput, seguimientoPatch } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { audit, requireAuth, requireRole, scopeForUser } from '../lib/auth.js';
import { assignLead } from '../services/assign.js';
import { enqueue } from '../lib/jobs.js';
import { guardarAudio, rutaPrivada } from '../lib/privados.js';
import { leerAjustes } from '../lib/ajustes.js';
import fs from 'node:fs';
import { z } from 'zod';
import { enviarPlantilla, enviarTexto, ventanaAbierta, } from '../services/whatsapp.js';
/** Tipos que son contacto real con el cliente. Una nota interna no cumple un seguimiento. */
const CONTACTO = new Set(['llamada', 'whatsapp', 'email', 'visita']);
/** Fin del día de hoy en Lima (UTC-5, sin horario de verano). */
function finDeHoyLima() {
    const offset = 5 * 60 * 60 * 1000;
    const lima = new Date(Date.now() - offset);
    lima.setUTCHours(23, 59, 59, 999);
    return new Date(lima.getTime() + offset);
}
/** La ruta en disco no sale de la API: el audio se pide por su endpoint. */
function sinRuta(nota) {
    const { audioPath: _ruta, ...resto } = nota;
    return resto;
}
export default async function leadRoutes(app) {
    app.addHook('preHandler', requireAuth);
    /**
     * Escribir exige un rol que pueda hacerlo.
     *
     * `requireAuth` solo comprueba que hay sesión. Sin esto, un usuario creado como «solo
     * lectura» podía registrar actividades, mover etapas y escribir por WhatsApp al cliente:
     * el rol existía en la interfaz y no en el servidor, que es donde cuenta. El caso real
     * no es el malicioso sino el jefe de obra al que se le da acceso «para que mire».
     */
    const escritura = requireRole('admin_lucuma', 'gerente', 'asesor');
    app.get('/', async (req, reply) => {
        const q = leadListQuery.safeParse(req.query);
        if (!q.success)
            return reply.code(400).send({ error: 'Filtros inválidos' });
        const user = req.user;
        const { page, perPage, q: texto, orden, ...filtros } = q.data;
        const where = { ...scopeForUser(user) };
        for (const [k, v] of Object.entries(filtros))
            if (v)
                where[k] = v;
        if (!filtros.status)
            where.status = { not: 'spam' };
        if (texto) {
            where.contact = {
                OR: [
                    { fname: { contains: texto } },
                    { lname: { contains: texto } },
                    { email: { contains: texto } },
                    { phone: { contains: texto } },
                    { document: { contains: texto } },
                ],
            };
        }
        const [total, leads] = await Promise.all([
            prisma.lead.count({ where }),
            prisma.lead.findMany({
                where,
                include: {
                    contact: true,
                    project: { select: { id: true, name: true } },
                    unit: { select: { id: true, code: true } },
                    stage: { select: { id: true, name: true, slug: true, color: true } },
                    owner: { select: { id: true, name: true } },
                },
                /**
                 * Por actividad reciente, no por fecha de creación.
                 *
                 * Lo que el asesor necesita arriba es lo que se movió: quien acaba de escribir por
                 * WhatsApp, no quien entró primero. `lastActivityAt` lo tocan la captura, las
                 * actividades y los mensajes entrantes, así que un lead de hace meses que vuelve
                 * a escribir sube solo.
                 *
                 * Se puede pedir el orden anterior con `orden=creacion`: hay quien trabaja la
                 * lista de arriba abajo y una lista que se reordena sola lo desorienta.
                 */
                orderBy: orden === 'creacion'
                    ? { createdAt: 'desc' }
                    : [{ lastActivityAt: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * perPage,
                take: perPage,
            }),
        ]);
        /**
         * Mensajes de WhatsApp sin leer, por lead.
         *
         * Va en una consulta aparte y no en el `include` porque la conversación cuelga del
         * CONTACTO, no del lead: la misma persona puede tener un lead viejo y uno nuevo, y su
         * conversación es una sola. Se resuelve sobre la página ya cargada, así que es una
         * consulta más por página, no una por lead.
         *
         * Sin esto, un mensaje entrante no se ve en ninguna parte hasta que alguien abre la
         * ficha por casualidad. Pasó en la puesta en marcha: el mensaje entró, creó actividad
         * sobre un lead existente, y en la lista no cambió nada.
         */
        const conversaciones = leads.length
            ? await prisma.waConversation.findMany({
                where: {
                    organizationId: user.organizationId,
                    contactId: { in: leads.map((l) => l.contactId) },
                },
                select: { contactId: true, unread: true, lastInboundAt: true },
            })
            : [];
        const porContacto = new Map();
        for (const c of conversaciones) {
            const previo = porContacto.get(c.contactId);
            porContacto.set(c.contactId, {
                // Un contacto podría tener conversación con más de un número del cliente.
                unread: (previo?.unread ?? 0) + c.unread,
                lastInboundAt: !previo?.lastInboundAt || (c.lastInboundAt && c.lastInboundAt > previo.lastInboundAt)
                    ? c.lastInboundAt
                    : previo.lastInboundAt,
            });
        }
        return {
            total,
            page,
            perPage,
            leads: leads.map((l) => ({
                ...l,
                whatsapp: porContacto.get(l.contactId) ?? null,
            })),
        };
    });
    app.get('/:id', async (req, reply) => {
        const user = req.user;
        const lead = await prisma.lead.findFirst({
            where: { id: req.params.id, ...scopeForUser(user) },
            include: {
                contact: true,
                project: true,
                unit: true,
                stage: true,
                owner: { select: { id: true, name: true, email: true } },
                activities: {
                    include: { user: { select: { id: true, name: true } } },
                    orderBy: { createdAt: 'desc' },
                },
                submissions: { select: { id: true, rawPayload: true, createdAt: true, formVersion: true } },
            },
        });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        await audit(user.organizationId, user.id, 'lead.view', { entity: 'lead', entityId: lead.id, ip: req.ip });
        return lead;
    });
    // ------------------------------------------------------------- whatsapp
    /**
     * Conversación de WhatsApp del lead.
     *
     * Cuelga del lead y no de una bandeja aparte a propósito: el asesor trabaja sobre la
     * ficha, con el proyecto, la unidad y el historial a la vista. Una bandeja suelta
     * obliga a mirar dos pantallas para contestar una pregunta sobre un departamento.
     */
    app.get('/:id/whatsapp', async (req, reply) => {
        const user = req.user;
        const lead = await prisma.lead.findFirst({
            where: { id: req.params.id, ...scopeForUser(user) },
            select: { id: true, contactId: true },
        });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        /**
         * Se busca por CONTACTO, no por lead: la conversación es de la persona y sobrevive a
         * los leads. Quien escribió hace ocho meses por otro proyecto tiene su historial aquí
         * y el asesor lo necesita antes de saludar.
         */
        const conversacion = await prisma.waConversation.findFirst({
            where: { organizationId: user.organizationId, contactId: lead.contactId },
            orderBy: { updatedAt: 'desc' },
            include: {
                waNumber: { select: { displayNumber: true, active: true } },
                messages: { orderBy: { createdAt: 'asc' }, take: 200 },
            },
        });
        if (!conversacion)
            return { conversacion: null, ventanaAbierta: false };
        if (conversacion.unread > 0) {
            await prisma.waConversation.update({ where: { id: conversacion.id }, data: { unread: 0 } });
        }
        return {
            conversacion: { ...conversacion, unread: 0 },
            ventanaAbierta: ventanaAbierta(conversacion),
        };
    });
    /** Enviar. Texto dentro de la ventana de 24 h, plantilla fuera de ella. */
    app.post('/:id/whatsapp', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const parsed = z
            .union([
            z.object({ text: z.string().min(1).max(4000) }),
            z.object({
                templateName: z.string().min(1),
                language: z.string().min(2).default('es'),
                variables: z.array(z.string()).optional(),
            }),
        ])
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const lead = await prisma.lead.findFirst({
            where: { id: req.params.id, ...scopeForUser(user) },
            select: { id: true, contactId: true, firstContactAt: true },
        });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        const conversacion = await prisma.waConversation.findFirst({
            where: { organizationId: user.organizationId, contactId: lead.contactId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true },
        });
        if (!conversacion) {
            return reply.code(409).send({
                error: 'Todavía no hay conversación con este contacto. WhatsApp no permite escribir primero salvo con una plantilla, y para eso el contacto tiene que existir en un número conectado.',
            });
        }
        const mensaje = 'text' in parsed.data
            ? await enviarTexto({ conversationId: conversacion.id, userId: user.id, text: parsed.data.text })
            : await enviarPlantilla({
                conversationId: conversacion.id,
                userId: user.id,
                templateName: parsed.data.templateName,
                language: parsed.data.language,
                variables: parsed.data.variables,
            });
        /**
         * Escribirle al cliente ES el primer contacto. Sin esto, el lead seguiría contando
         * como no atendido y la alerta de SLA saltaría igual sobre un asesor que ya respondió.
         */
        await prisma.lead.update({
            where: { id: lead.id },
            data: { lastActivityAt: new Date(), firstContactAt: lead.firstContactAt ?? new Date() },
        });
        return mensaje;
    });
    /**
     * Registra una actividad y, si se pide, agenda la siguiente. La usan el formulario de la
     * ficha y la confirmación de una nota de voz: las dos tienen que cerrar seguimientos y
     * marcar el primer contacto exactamente igual.
     */
    async function registrarActividad(user, lead, datos, meta) {
        const ahora = new Date();
        /**
         * Un contacto real cumple los seguimientos de hoy y los vencidos de este lead.
         *
         * Los futuros no: si el jueves hay visita agendada y hoy se manda un WhatsApp, la visita
         * sigue en pie. Sin este cierre la lista de seguimientos solo crecía y todo acababa
         * «vencido», que es lo mismo que no tener lista.
         */
        const cerrados = CONTACTO.has(datos.type)
            ? await prisma.activity.updateMany({
                where: { leadId: lead.id, doneAt: null, dueAt: { not: null, lte: finDeHoyLima() } },
                data: { doneAt: ahora },
            })
            : { count: 0 };
        const creada = await prisma.activity.create({
            data: {
                leadId: lead.id,
                userId: user.id,
                type: datos.type,
                body: datos.body,
                meta: meta,
                doneAt: ahora,
            },
        });
        if (datos.nextDueAt) {
            await prisma.activity.create({
                data: {
                    leadId: lead.id,
                    userId: user.id,
                    type: (datos.nextType ?? 'llamada'),
                    body: datos.nextBody?.trim() || 'Seguimiento agendado',
                    dueAt: new Date(datos.nextDueAt),
                },
            });
        }
        await prisma.lead.update({
            where: { id: lead.id },
            data: { lastActivityAt: ahora, firstContactAt: lead.firstContactAt ?? ahora },
        });
        return { ...creada, seguimientosCerrados: cerrados.count };
    }
    /** Registrar actividad. Si se agenda la siguiente, se crea pendiente en el mismo paso. */
    app.post('/:id/activities', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const parsed = activityInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        return registrarActividad(user, lead, parsed.data);
    });
    // ------------------------------------------------------------ notas de voz
    /** Subir una nota de voz. Se procesa en un job; la respuesta no espera a la transcripción. */
    app.post('/:id/notas-voz', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        const archivo = await req.file();
        if (!archivo)
            return reply.code(400).send({ error: 'No llegó la grabación.' });
        let contenido;
        try {
            contenido = await archivo.toBuffer();
        }
        catch {
            return reply.code(413).send({ error: 'La grabación es demasiado larga.' });
        }
        const duracion = Number(archivo.fields.duracion?.value);
        const res = await guardarAudio(user.organizationId, contenido, archivo.mimetype);
        if ('error' in res)
            return reply.code(400).send({ error: res.error });
        const { transcribirVoz } = await leerAjustes(user.organizationId);
        const nota = await prisma.notaVoz.create({
            data: {
                organizationId: user.organizationId,
                leadId: lead.id,
                userId: user.id,
                audioPath: res.ruta,
                mime: res.mime,
                bytes: res.bytes,
                durationSec: Number.isFinite(duracion) ? Math.round(duracion) : null,
                // Con la transcripción apagada la nota es solo audio: no sale nada del servidor.
                status: transcribirVoz ? 'pendiente' : 'guardada',
            },
        });
        if (transcribirVoz)
            await enqueue('voz.procesar', { notaId: nota.id });
        return sinRuta(nota);
    });
    /** Notas de voz del lead, la más reciente primero. */
    app.get('/:id/notas-voz', async (req, reply) => {
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(req.user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        const [notas, ajustes] = await Promise.all([
            prisma.notaVoz.findMany({
                where: { leadId: lead.id },
                orderBy: { createdAt: 'desc' },
                take: 20,
                include: { user: { select: { name: true } } },
            }),
            leerAjustes(req.user.organizationId),
        ]);
        return { transcribir: ajustes.transcribirVoz, notas: notas.map(sinRuta) };
    });
    /** El audio, solo para quien puede ver el lead. Nunca por una URL pública. */
    app.get('/notas-voz/:id/audio', async (req, reply) => {
        const nota = await buscarNota(req.params.id, req.user);
        if (!nota)
            return reply.code(404).send({ error: 'Nota no encontrada' });
        reply.header('Content-Type', nota.mime);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send(fs.createReadStream(rutaPrivada(nota.audioPath)));
    });
    /**
     * Transcribir una nota: la que falló (por ejemplo, antes de configurar la clave) o una
     * guardada solo como audio cuando la transcripción estaba apagada.
     */
    app.post('/notas-voz/:id/reintentar', { preHandler: escritura }, async (req, reply) => {
        const nota = await buscarNota(req.params.id, req.user);
        if (!nota)
            return reply.code(404).send({ error: 'Nota no encontrada' });
        if (nota.status === 'lista')
            return reply.code(409).send({ error: 'La nota ya está lista.' });
        if (!(await leerAjustes(nota.organizationId)).transcribirVoz) {
            return reply.code(409).send({ error: 'La transcripción está apagada en Ajustes.' });
        }
        await prisma.notaVoz.update({ where: { id: nota.id }, data: { status: nota.transcript ? 'transcrita' : 'pendiente', error: null } });
        await enqueue('voz.procesar', { notaId: nota.id });
        return { ok: true };
    });
    /**
     * Registrar la propuesta, ya revisada por el asesor. Lo que llega es lo que el asesor
     * dejó en pantalla, no la propuesta original: puede haber corregido la fecha o el texto.
     */
    app.post('/notas-voz/:id/registrar', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const parsed = activityInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const nota = await buscarNota(req.params.id, user);
        if (!nota)
            return reply.code(404).send({ error: 'Nota no encontrada' });
        if (nota.activityId)
            return reply.code(409).send({ error: 'Esta nota ya se registró.' });
        const lead = await prisma.lead.findUniqueOrThrow({ where: { id: nota.leadId } });
        const res = await registrarActividad(user, lead, parsed.data, { notaVozId: nota.id });
        await prisma.notaVoz.update({ where: { id: nota.id }, data: { activityId: res.id } });
        return res;
    });
    async function buscarNota(id, user) {
        return prisma.notaVoz.findFirst({ where: { id, lead: scopeForUser(user) } });
    }
    /** Agendar un seguimiento sin registrar antes una actividad. */
    app.post('/:id/seguimientos', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const parsed = seguimientoInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        return prisma.activity.create({
            data: {
                leadId: lead.id,
                userId: user.id,
                type: parsed.data.type,
                body: parsed.data.body || 'Seguimiento agendado',
                dueAt: new Date(parsed.data.dueAt),
            },
        });
    });
    /** Marcar hecho o reprogramar. Solo sobre seguimientos de leads que el usuario puede ver. */
    app.patch('/seguimientos/:id', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const parsed = seguimientoPatch.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const seg = await prisma.activity.findFirst({
            where: { id: req.params.id, dueAt: { not: null }, doneAt: null, lead: scopeForUser(user) },
        });
        if (!seg)
            return reply.code(404).send({ error: 'Seguimiento no encontrado o ya cerrado' });
        const ahora = new Date();
        const actualizado = await prisma.activity.update({
            where: { id: seg.id },
            data: parsed.data.hecho ? { doneAt: ahora } : { dueAt: new Date(parsed.data.dueAt) },
        });
        if (parsed.data.hecho) {
            await prisma.lead.update({ where: { id: seg.leadId }, data: { lastActivityAt: ahora } });
        }
        return actualizado;
    });
    app.patch('/:id', { preHandler: escritura }, async (req, reply) => {
        const user = req.user;
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
        const { stageId, status, ownerId } = req.body ?? {};
        if (stageId && stageId !== lead.stageId) {
            const etapa = await prisma.stage.findFirst({
                where: { id: stageId, organizationId: user.organizationId },
            });
            if (!etapa)
                return reply.code(400).send({ error: 'Etapa inválida' });
            await prisma.activity.create({
                data: {
                    leadId: lead.id,
                    userId: user.id,
                    type: 'cambio_etapa',
                    body: `Etapa → ${etapa.name}`,
                },
            });
        }
        if (ownerId && ownerId !== lead.ownerId) {
            if (user.role === 'asesor')
                return reply.code(403).send({ error: 'Sin permisos para reasignar' });
            await assignLead(lead.id, ownerId, 'manual');
        }
        return prisma.lead.update({
            where: { id: lead.id },
            data: {
                stageId: stageId ?? undefined,
                status: status ?? undefined,
            },
            include: { stage: true, owner: { select: { id: true, name: true } } },
        });
    });
    /**
     * Seguimientos pendientes.
     *
     * Pertenecen al asesor ACTUAL del lead, no a quien los agendó: si un lead se reasigna, sus
     * seguimientos se van con él. Por eso se filtra por `lead.ownerId` y no por `userId`.
     *
     * El asesor ve siempre los suyos. Gerencia elige: los suyos, los de todo el equipo o los
     * de un asesor (`asesor=sin` para leads sin asignar).
     */
    app.get('/seguimientos', async (req) => {
        const user = req.user;
        const gestiona = user.role !== 'asesor';
        const equipo = gestiona && req.query.vista === 'equipo';
        let dueno = { ownerId: user.id };
        if (equipo) {
            const a = req.query.asesor;
            dueno = !a ? {} : a === 'sin' ? { ownerId: null } : { ownerId: a };
        }
        return prisma.activity.findMany({
            where: {
                doneAt: null,
                dueAt: { not: null },
                lead: { organizationId: user.organizationId, status: 'activo', ...dueno },
            },
            include: {
                lead: {
                    include: {
                        contact: true,
                        project: { select: { name: true } },
                        owner: { select: { id: true, name: true } },
                    },
                },
            },
            orderBy: { dueAt: 'asc' },
            take: 300,
        });
    });
}
