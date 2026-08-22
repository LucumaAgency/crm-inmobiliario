import { activityInput, leadListQuery } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { audit, requireAuth, scopeForUser } from '../lib/auth.js';
import { assignLead } from '../services/assign.js';
export default async function leadRoutes(app) {
    app.addHook('preHandler', requireAuth);
    app.get('/', async (req, reply) => {
        const q = leadListQuery.safeParse(req.query);
        if (!q.success)
            return reply.code(400).send({ error: 'Filtros inválidos' });
        const user = req.user;
        const { page, perPage, q: texto, ...filtros } = q.data;
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
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * perPage,
                take: perPage,
            }),
        ]);
        return { total, page, perPage, leads };
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
    /** Registrar actividad. Si se agenda la siguiente, se crea pendiente en el mismo paso. */
    app.post('/:id/activities', async (req, reply) => {
        const user = req.user;
        const parsed = activityInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const lead = await prisma.lead.findFirst({ where: { id: req.params.id, ...scopeForUser(user) } });
        if (!lead)
            return reply.code(404).send({ error: 'Lead no encontrado' });
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
    app.patch('/:id', async (req, reply) => {
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
    /** Tareas pendientes del usuario. Es la pantalla que abre el asesor al empezar el día. */
    app.get('/tasks/pending', async (req) => {
        const user = req.user;
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
