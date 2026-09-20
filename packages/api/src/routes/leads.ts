import type { FastifyInstance } from 'fastify';
import { activityInput, leadListQuery } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { audit, requireAuth, scopeForUser } from '../lib/auth.js';
import { assignLead } from '../services/assign.js';
import { z } from 'zod';
import {
  enviarPlantilla,
  enviarTexto,
  ventanaAbierta,
} from '../services/whatsapp.js';

export default async function leadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/', async (req, reply) => {
    const q = leadListQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Filtros inválidos' });
    const user = req.user!;
    const { page, perPage, q: texto, orden, ...filtros } = q.data;

    const where: Record<string, unknown> = { ...scopeForUser(user) };
    for (const [k, v] of Object.entries(filtros)) if (v) where[k] = v;
    if (!filtros.status) where.status = { not: 'spam' };
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
        orderBy:
          orden === 'creacion'
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

    const porContacto = new Map<string, { unread: number; lastInboundAt: Date | null }>();
    for (const c of conversaciones) {
      const previo = porContacto.get(c.contactId);
      porContacto.set(c.contactId, {
        // Un contacto podría tener conversación con más de un número del cliente.
        unread: (previo?.unread ?? 0) + c.unread,
        lastInboundAt:
          !previo?.lastInboundAt || (c.lastInboundAt && c.lastInboundAt > previo.lastInboundAt)
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

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const user = req.user!;
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
    if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });
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
  app.get<{ Params: { id: string } }>('/:id/whatsapp', async (req, reply) => {
    const user = req.user!;
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...scopeForUser(user) },
      select: { id: true, contactId: true },
    });
    if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });

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
    if (!conversacion) return { conversacion: null, ventanaAbierta: false };

    if (conversacion.unread > 0) {
      await prisma.waConversation.update({ where: { id: conversacion.id }, data: { unread: 0 } });
    }

    return {
      conversacion: { ...conversacion, unread: 0 },
      ventanaAbierta: ventanaAbierta(conversacion),
    };
  });

  /** Enviar. Texto dentro de la ventana de 24 h, plantilla fuera de ella. */
  app.post<{ Params: { id: string } }>('/:id/whatsapp', async (req, reply) => {
    const user = req.user!;
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
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, ...scopeForUser(user) },
      select: { id: true, contactId: true, firstContactAt: true },
    });
    if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });

    const conversacion = await prisma.waConversation.findFirst({
      where: { organizationId: user.organizationId, contactId: lead.contactId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (!conversacion) {
      return reply.code(409).send({
        error:
          'Todavía no hay conversación con este contacto. WhatsApp no permite escribir primero salvo con una plantilla, y para eso el contacto tiene que existir en un número conectado.',
      });
    }

    const mensaje =
      'text' in parsed.data
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

  /** Registrar actividad. Si se agenda la siguiente, se crea pendiente en el mismo paso. */
  app.post<{ Params: { id: string } }>('/:id/activities', async (req, reply) => {
    const user = req.user!;
    const parsed = activityInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });

    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
    if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });

    const ahora = new Date();
    const creada = await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: user.id,
        type: parsed.data.type,
        body: parsed.data.body,
        doneAt: ahora,
      },
    });

    if (parsed.data.nextDueAt) {
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          userId: user.id,
          type: parsed.data.nextType ?? 'llamada',
          body: 'Seguimiento agendado',
          dueAt: new Date(parsed.data.nextDueAt),
        },
      });
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: ahora, firstContactAt: lead.firstContactAt ?? ahora },
    });
    return creada;
  });

  app.patch<{ Params: { id: string }; Body: { stageId?: string; status?: string; ownerId?: string } }>(
    '/:id',
    async (req, reply) => {
      const user = req.user!;
      const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
      if (!lead) return reply.code(404).send({ error: 'Lead no encontrado' });

      const { stageId, status, ownerId } = req.body ?? {};

      if (stageId && stageId !== lead.stageId) {
        const etapa = await prisma.stage.findFirst({
          where: { id: stageId, organizationId: user.organizationId },
        });
        if (!etapa) return reply.code(400).send({ error: 'Etapa inválida' });
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
        if (user.role === 'asesor') return reply.code(403).send({ error: 'Sin permisos para reasignar' });
        await assignLead(lead.id, ownerId, 'manual');
      }

      return prisma.lead.update({
        where: { id: lead.id },
        data: {
          stageId: stageId ?? undefined,
          status: (status as never) ?? undefined,
        },
        include: { stage: true, owner: { select: { id: true, name: true } } },
      });
    }
  );

  /** Tareas pendientes del usuario. Es la pantalla que abre el asesor al empezar el día. */
  app.get('/tasks/pending', async (req) => {
    const user = req.user!;
    return prisma.activity.findMany({
      where: {
        userId: user.id,
        doneAt: null,
        dueAt: { not: null },
        lead: { organizationId: user.organizationId, status: 'activo' },
      },
      include: { lead: { include: { contact: true, project: { select: { name: true } } } } },
      orderBy: { dueAt: 'asc' },
      take: 100,
    });
  });
}
