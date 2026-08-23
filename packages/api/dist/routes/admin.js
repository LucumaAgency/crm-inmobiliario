import { z } from 'zod';
import { formSchema } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { audit, requireAuth, requireRole } from '../lib/auth.js';
import { generatePublicKey, generateSecretKey, hashKey } from '../lib/keys.js';
import { captureLead } from '../services/capture.js';
/** Gestión: proyectos, unidades, formularios, sitios, usuarios, etapas. */
export default async function adminRoutes(app) {
    app.addHook('preHandler', requireAuth);
    const gestion = requireRole('admin_lucuma', 'gerente');
    // ------------------------------------------------------------- etapas
    app.get('/stages', async (req) => prisma.stage.findMany({
        where: { organizationId: req.user.organizationId },
        orderBy: { position: 'asc' },
    }));
    // ---------------------------------------------------------- proyectos
    app.get('/projects', async (req) => prisma.project.findMany({
        where: { organizationId: req.user.organizationId },
        include: { _count: { select: { units: true, leads: true } } },
        orderBy: { name: 'asc' },
    }));
    const projectInput = z.object({
        name: z.string().min(1),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        code: z.string().optional(),
        address: z.string().optional(),
    });
    app.post('/projects', { preHandler: gestion }, async (req, reply) => {
        const parsed = projectInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        return prisma.project.create({
            data: { ...parsed.data, organizationId: req.user.organizationId },
        });
    });
    // --------------------------------------------------------- tipologías
    app.get('/projects/:id/typologies', async (req) => prisma.typology.findMany({
        where: { projectId: req.params.id, project: { organizationId: req.user.organizationId } },
        orderBy: [{ position: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { units: true } } },
    }));
    const typologyInput = z.object({
        name: z.string().min(1),
        code: z.string().optional(),
        bedrooms: z.number().int().optional(),
        bathrooms: z.number().int().optional(),
        areaM2: z.number().optional(),
        priceFrom: z.number().optional(),
        currency: z.string().default('PEN'),
        description: z.string().optional(),
        planUrl: z.string().url().optional().or(z.literal('')),
        imageUrl: z.string().url().optional().or(z.literal('')),
        position: z.number().int().optional(),
        active: z.boolean().optional(),
    });
    app.post('/projects/:id/typologies', { preHandler: gestion }, async (req, reply) => {
        const parsed = typologyInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const project = await prisma.project.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!project)
            return reply.code(404).send({ error: 'Proyecto no encontrado' });
        return prisma.typology.create({ data: { ...parsed.data, projectId: project.id } });
    });
    app.patch('/typologies/:id', { preHandler: gestion }, async (req, reply) => {
        const parsed = typologyInput.partial().safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const tip = await prisma.typology.findFirst({
            where: { id: req.params.id, project: { organizationId: req.user.organizationId } },
        });
        if (!tip)
            return reply.code(404).send({ error: 'Tipología no encontrada' });
        return prisma.typology.update({ where: { id: tip.id }, data: parsed.data });
    });
    /**
     * Borrar una tipología.
     *
     * Las unidades no se tocan: la relación es `SetNull`, así que quedan sin tipología en vez
     * de desaparecer del inventario. Se avisa cuántas quedan sueltas para que quien borra lo
     * sepa antes de irse.
     */
    app.delete('/typologies/:id', { preHandler: gestion }, async (req, reply) => {
        const tip = await prisma.typology.findFirst({
            where: { id: req.params.id, project: { organizationId: req.user.organizationId } },
            include: { _count: { select: { units: true } } },
        });
        if (!tip)
            return reply.code(404).send({ error: 'Tipología no encontrada' });
        await prisma.typology.delete({ where: { id: tip.id } });
        return { ok: true, unidadesSinTipologia: tip._count.units };
    });
    // ----------------------------------------------------------- unidades
    app.get('/projects/:id/units', async (req) => prisma.unit.findMany({
        where: { projectId: req.params.id, project: { organizationId: req.user.organizationId } },
        orderBy: { code: 'asc' },
        include: { typologyRef: { select: { id: true, name: true } } },
    }));
    const unitInput = z.object({
        code: z.string().min(1),
        typologyId: z.string().optional().or(z.literal('')),
        typology: z.string().optional(),
        kind: z.enum(['departamento', 'estacionamiento', 'deposito', 'lote', 'oficina', 'otro']).default('departamento'),
        status: z.enum(['disponible', 'reservado', 'vendido', 'no_disponible']).default('disponible'),
        bedrooms: z.number().int().optional(),
        areaM2: z.number().optional(),
        price: z.number().optional(),
        currency: z.string().default('PEN'),
        floor: z.number().int().optional(),
    });
    app.post('/projects/:id/units', { preHandler: gestion }, async (req, reply) => {
        const parsed = unitInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const project = await prisma.project.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!project)
            return reply.code(404).send({ error: 'Proyecto no encontrado' });
        // Un select vacío llega como cadena vacía y rompería la clave foránea.
        const { typologyId, ...resto } = parsed.data;
        return prisma.unit.create({
            data: { ...resto, typologyId: typologyId || null, projectId: project.id },
        });
    });
    /**
     * Importación masiva de unidades.
     *
     * Cargar un edificio de 80 departamentos a mano no es razonable, y el inventario suele
     * llegar en un Excel del cliente. El CSV se convierte a filas en el navegador y aquí solo
     * se valida y se guarda.
     *
     * Dos decisiones que hacen que se pueda repetir sin miedo:
     *
     *  - **Se hace upsert por `(proyecto, código)`**, que ya es único. Reimportar el mismo
     *    archivo actualiza en vez de fallar a mitad, y es lo que permite usar la importación
     *    también para actualizar precios y estados, que es lo que el cliente manda cada mes.
     *  - **Las filas malas no abortan el lote.** Se importan las buenas y se devuelve el
     *    detalle de las que no, con su número de línea. Un archivo de 80 filas con dos
     *    erratas debe cargar 78, no cero.
     */
    app.post('/projects/:id/units/import', { preHandler: gestion }, async (req, reply) => {
        const entrada = z
            .object({
            crearTipologias: z.boolean().default(true),
            filas: z.array(z.record(z.string())).min(1).max(2000),
        })
            .safeParse(req.body);
        if (!entrada.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const project = await prisma.project.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!project)
            return reply.code(404).send({ error: 'Proyecto no encontrado' });
        const tipologias = await prisma.typology.findMany({ where: { projectId: project.id } });
        const porNombre = new Map(tipologias.map((t) => [t.name.trim().toLowerCase(), t]));
        const numero = (v) => {
            if (v === undefined)
                return undefined;
            const limpio = v.replace(/[^0-9.,-]/g, '').replace(',', '.');
            if (limpio === '')
                return undefined;
            const n = Number(limpio);
            return Number.isFinite(n) ? n : undefined;
        };
        const KIND = ['departamento', 'estacionamiento', 'deposito', 'lote', 'oficina', 'otro'];
        const STATUS = ['disponible', 'reservado', 'vendido', 'no_disponible'];
        let creadas = 0;
        let actualizadas = 0;
        const tipologiasCreadas = [];
        const errores = [];
        for (let i = 0; i < entrada.data.filas.length; i += 1) {
            const fila = entrada.data.filas[i];
            const linea = i + 2; // +1 por el índice, +1 por la cabecera del archivo
            const code = (fila.codigo ?? '').trim();
            if (!code) {
                errores.push({ linea, codigo: '', motivo: 'Falta el código de la unidad' });
                continue;
            }
            const kind = (fila.tipo ?? 'departamento').trim().toLowerCase();
            const status = (fila.estado ?? 'disponible').trim().toLowerCase();
            if (!KIND.includes(kind)) {
                errores.push({ linea, codigo: code, motivo: `Tipo no reconocido: "${fila.tipo}"` });
                continue;
            }
            if (!STATUS.includes(status)) {
                errores.push({ linea, codigo: code, motivo: `Estado no reconocido: "${fila.estado}"` });
                continue;
            }
            // Tipología por nombre. Se crea si falta y así se pidió, para no obligar a darla de
            // alta a mano antes de importar.
            let typologyId = null;
            const nombreTip = (fila.tipologia ?? '').trim();
            if (nombreTip) {
                const clave = nombreTip.toLowerCase();
                let tip = porNombre.get(clave);
                if (!tip && entrada.data.crearTipologias) {
                    tip = await prisma.typology.create({
                        data: {
                            projectId: project.id,
                            name: nombreTip,
                            bedrooms: numero(fila.dormitorios),
                            areaM2: numero(fila.area_m2),
                        },
                    });
                    porNombre.set(clave, tip);
                    tipologiasCreadas.push(nombreTip);
                }
                if (!tip) {
                    errores.push({ linea, codigo: code, motivo: `La tipología "${nombreTip}" no existe` });
                    continue;
                }
                typologyId = tip.id;
            }
            const datos = {
                typologyId,
                typology: nombreTip || null,
                kind: kind,
                status: status,
                bedrooms: numero(fila.dormitorios),
                areaM2: numero(fila.area_m2),
                price: numero(fila.precio),
                currency: (fila.moneda ?? 'PEN').trim().toUpperCase() || 'PEN',
                floor: numero(fila.piso),
            };
            try {
                const existente = await prisma.unit.findFirst({
                    where: { projectId: project.id, code },
                    select: { id: true },
                });
                if (existente) {
                    await prisma.unit.update({ where: { id: existente.id }, data: datos });
                    actualizadas += 1;
                }
                else {
                    await prisma.unit.create({ data: { ...datos, code, projectId: project.id } });
                    creadas += 1;
                }
            }
            catch (err) {
                errores.push({
                    linea,
                    codigo: code,
                    motivo: err instanceof Error ? err.message.split('\n')[0] : 'Error al guardar',
                });
            }
        }
        return { creadas, actualizadas, tipologiasCreadas, errores };
    });
    app.patch('/units/:id', { preHandler: gestion }, async (req, reply) => {
        const parsed = unitInput.partial().safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const unit = await prisma.unit.findFirst({
            where: { id: req.params.id, project: { organizationId: req.user.organizationId } },
        });
        if (!unit)
            return reply.code(404).send({ error: 'Unidad no encontrada' });
        const { typologyId, ...resto } = parsed.data;
        return prisma.unit.update({
            where: { id: unit.id },
            data: { ...resto, ...(typologyId === undefined ? {} : { typologyId: typologyId || null }) },
        });
    });
    // -------------------------------------------------------- formularios
    app.get('/forms', async (req) => prisma.form.findMany({
        where: { organizationId: req.user.organizationId },
        include: {
            project: { select: { id: true, name: true } },
            site: { select: { id: true, name: true } },
            _count: { select: { submissions: true } },
        },
        orderBy: { updatedAt: 'desc' },
    }));
    app.get('/forms/:id', async (req, reply) => {
        const form = await prisma.form.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!form)
            return reply.code(404).send({ error: 'Formulario no encontrado' });
        return form;
    });
    const formInput = z.object({
        name: z.string().min(1),
        projectId: z.string().nullable().optional(),
        siteId: z.string().nullable().optional(),
        notifyEmails: z.array(z.string().email()).default([]),
        schema: formSchema,
    });
    app.post('/forms', { preHandler: gestion }, async (req, reply) => {
        const parsed = formInput.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Esquema inválido', detail: parsed.error.flatten() });
        }
        const { schema, notifyEmails, ...resto } = parsed.data;
        return prisma.form.create({
            data: {
                ...resto,
                organizationId: req.user.organizationId,
                schema: schema,
                notifyEmails: notifyEmails,
            },
        });
    });
    /** Cada cambio sube `version`: es lo que invalida la caché del conector. */
    app.put('/forms/:id', { preHandler: gestion }, async (req, reply) => {
        const parsed = formInput.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'Esquema inválido', detail: parsed.error.flatten() });
        }
        const form = await prisma.form.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!form)
            return reply.code(404).send({ error: 'Formulario no encontrado' });
        const { schema, notifyEmails, ...resto } = parsed.data;
        return prisma.form.update({
            where: { id: form.id },
            data: {
                ...resto,
                schema: schema,
                notifyEmails: notifyEmails,
                version: { increment: 1 },
            },
        });
    });
    // -------------------------------------------------------------- sitios
    app.get('/sites', { preHandler: gestion }, async (req) => {
        const sites = await prisma.site.findMany({
            where: { organizationId: req.user.organizationId },
            orderBy: { createdAt: 'desc' },
        });
        // La secret key no se devuelve nunca: solo se ve una vez, al generarla.
        return sites.map(({ secretKeyHash, ...s }) => s);
    });
    app.post('/sites', { preHandler: gestion }, async (req, reply) => {
        const parsed = z
            .object({ name: z.string().min(1), allowedOrigins: z.array(z.string()).min(1) })
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const publicKey = generatePublicKey();
        const secretKey = generateSecretKey();
        const site = await prisma.site.create({
            data: {
                organizationId: req.user.organizationId,
                name: parsed.data.name,
                publicKey,
                secretKeyHash: hashKey(secretKey),
                allowedOrigins: parsed.data.allowedOrigins,
            },
        });
        await audit(req.user.organizationId, req.user.id, 'keys.create', { entity: 'site', entityId: site.id });
        // Única vez que la secret key viaja al cliente.
        return { ...site, secretKeyHash: undefined, secretKey };
    });
    app.post('/sites/:id/rotate', { preHandler: gestion }, async (req, reply) => {
        const site = await prisma.site.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!site)
            return reply.code(404).send({ error: 'Sitio no encontrado' });
        const secretKey = generateSecretKey();
        await prisma.site.update({ where: { id: site.id }, data: { secretKeyHash: hashKey(secretKey) } });
        await audit(req.user.organizationId, req.user.id, 'keys.rotate', { entity: 'site', entityId: site.id });
        return { secretKey };
    });
    // ------------------------------------------------------------ usuarios
    app.get('/users', { preHandler: gestion }, async (req) => prisma.user.findMany({
        where: { organizationId: req.user.organizationId },
        select: { id: true, name: true, email: true, role: true, active: true, lastLoginAt: true },
        orderBy: { name: 'asc' },
    }));
    app.post('/users', { preHandler: gestion }, async (req, reply) => {
        const parsed = z
            .object({
            name: z.string().min(1),
            email: z.string().email(),
            role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).default('asesor'),
        })
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        return prisma.user.create({
            data: {
                ...parsed.data,
                email: parsed.data.email.toLowerCase(),
                organizationId: req.user.organizationId,
            },
            select: { id: true, name: true, email: true, role: true, active: true },
        });
    });
    /**
     * Activar/desactivar un usuario y cambiar su rol.
     *
     * No hay borrado: un usuario aparece en asignaciones, actividades y auditoría, y
     * borrarlo dejaría el historial sin dueño justo donde importa saber quién hizo qué.
     * Desactivar le quita el acceso (el magic link exige `active`) y lo saca del reparto
     * automático de leads (`pickOwner` solo mira activos), que es lo que se busca.
     */
    app.patch('/users/:id', { preHandler: gestion }, async (req, reply) => {
        const parsed = z
            .object({
            active: z.boolean().optional(),
            role: z.enum(['admin_lucuma', 'gerente', 'asesor', 'solo_lectura']).optional(),
        })
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const objetivo = await prisma.user.findFirst({
            where: { id: req.params.id, organizationId: req.user.organizationId },
        });
        if (!objetivo)
            return reply.code(404).send({ error: 'Usuario no encontrado' });
        // Quedarse sin ningún administrador activo deja la organización sin quien gestione.
        if (parsed.data.active === false || (parsed.data.role && parsed.data.role !== 'admin_lucuma')) {
            if (objetivo.role === 'admin_lucuma') {
                const otros = await prisma.user.count({
                    where: {
                        organizationId: req.user.organizationId,
                        role: 'admin_lucuma',
                        active: true,
                        id: { not: objetivo.id },
                    },
                });
                if (otros === 0) {
                    return reply.code(409).send({
                        error: 'Es el único administrador activo. Crea o activa otro antes de cambiarlo.',
                    });
                }
            }
        }
        return prisma.user.update({
            where: { id: objetivo.id },
            data: parsed.data,
            select: { id: true, name: true, email: true, role: true, active: true },
        });
    });
    // -------------------------------------------------------- alta manual
    app.post('/leads', async (req, reply) => {
        const parsed = z
            .object({
            fname: z.string().min(1),
            lname: z.string().optional(),
            email: z.string().email().optional().or(z.literal('')),
            phone: z.string().optional(),
            document: z.string().optional(),
            message: z.string().optional(),
            projectId: z.string().optional(),
            source: z.string().default('manual'),
        })
            .safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const { projectId, source, ...values } = parsed.data;
        const result = await captureLead({
            idempotencyKey: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            values: values,
        }, null, { organizationId: req.user.organizationId, projectId: projectId ?? null, source, ip: req.ip });
        return result;
    });
    // ---------------------------------------------------------- exportación
    app.get('/leads/export', { preHandler: gestion }, async (req, reply) => {
        const user = req.user;
        const leads = await prisma.lead.findMany({
            where: { organizationId: user.organizationId },
            include: {
                contact: true,
                project: { select: { name: true } },
                unit: { select: { code: true } },
                stage: { select: { name: true } },
                owner: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        // La exportación masiva es el evento crítico de auditoría del rubro.
        await audit(user.organizationId, user.id, 'lead.export', {
            meta: { count: leads.length },
            ip: req.ip,
        });
        const cab = ['fecha', 'nombre', 'apellido', 'telefono', 'email', 'documento', 'proyecto', 'unidad', 'etapa', 'asesor', 'fuente', 'mensaje'];
        const filas = leads.map((l) => [
            l.createdAt.toISOString(),
            l.contact.fname, l.contact.lname ?? '', l.contact.phone ?? '', l.contact.email ?? '', l.contact.document ?? '',
            l.project?.name ?? '', l.unit?.code ?? '', l.stage?.name ?? '', l.owner?.name ?? '', l.source, (l.message ?? '').replace(/\n/g, ' '),
        ]);
        const csv = [cab, ...filas]
            .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`);
        return '﻿' + csv;
    });
    // --------------------------------------------------------- estadísticas
    app.get('/stats', async (req) => {
        const user = req.user;
        const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [total, mes, porEtapa, sinContactar] = await Promise.all([
            prisma.lead.count({ where: { organizationId: user.organizationId, status: 'activo' } }),
            prisma.lead.count({ where: { organizationId: user.organizationId, createdAt: { gte: desde } } }),
            prisma.lead.groupBy({
                by: ['stageId'],
                where: { organizationId: user.organizationId, status: 'activo' },
                _count: true,
            }),
            prisma.lead.count({
                where: { organizationId: user.organizationId, status: 'activo', firstContactAt: null },
            }),
        ]);
        return { total, ultimos30: mes, porEtapa, sinContactar };
    });
}
