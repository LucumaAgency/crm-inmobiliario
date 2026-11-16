/**
 * Rutas del botón «Conectar WhatsApp» (alta incrustada). Ver `services/whatsapp-alta.ts`.
 *
 * Con sesión, en el subdominio del cliente:
 *  - `GET  /api/v1/whatsapp/alta/estado` — ¿está configurado el botón?
 *  - `POST /api/v1/whatsapp/alta/pase`   — emite el pase y devuelve la URL de la página
 *                                          puente en el dominio base.
 *
 * Sin sesión, desde la página puente (el pase es la credencial):
 *  - `POST /api/v1/whatsapp/alta/info`      — organización y modo, para mostrarlos.
 *  - `POST /api/v1/whatsapp/alta/completar` — código de Meta + datos del evento.
 *  - `POST /api/v1/whatsapp/alta/evento`    — alta cancelada o con error en Meta (registro).
 *
 * El pase va siempre en el CUERPO, nunca en la URL: así no queda en logs de acceso.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import rateLimit from '@fastify/rate-limit';
import { prisma } from '../db.js';
import { requireAuth, requirePermiso } from '../lib/auth.js';
import { baseUrlDePeticion } from '../lib/tenant.js';
import {
  ErrorAlta,
  altaDisponible,
  completarAlta,
  configPublica,
  crearPase,
  registrarFinSinCodigo,
  verPase,
} from '../services/whatsapp-alta.js';

export default async function whatsappAltaRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------- con sesión
  await app.register(async (privado) => {
    privado.addHook('preHandler', requireAuth);

    privado.get('/estado', async () => ({ disponible: altaDisponible() }));

    const cuerpoPase = z.object({
      modo: z.enum(['coexistencia', 'nuevo']),
      ownerUserId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
    });

    privado.post('/pase', { preHandler: requirePermiso('canales.configurar') }, async (req, reply) => {
      if (!altaDisponible()) {
        return reply.code(503).send({ error: 'El botón no está configurado en el servidor (META_WA_CONFIG_ID).' });
      }
      const parsed = cuerpoPase.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
      const u = req.user!;
      const { modo, ownerUserId, projectId } = parsed.data;

      if (ownerUserId) {
        const ok = await prisma.user.findFirst({
          where: { id: ownerUserId, organizationId: u.organizationId, active: true },
          select: { id: true },
        });
        if (!ok) return reply.code(400).send({ error: 'Ese asesor no existe o está desactivado.' });
      }
      if (projectId) {
        const ok = await prisma.project.findFirst({ where: { id: projectId, organizationId: u.organizationId } });
        if (!ok) return reply.code(400).send({ error: 'Proyecto no encontrado.' });
      }

      return crearPase({
        organizationId: u.organizationId,
        userId: u.id,
        modo,
        ownerUserId: ownerUserId ?? null,
        projectId: projectId ?? null,
        volverA: baseUrlDePeticion(req),
      });
    });
  });

  // ---------------------------------------------- sin sesión (página puente)
  await app.register(async (puente) => {
    await puente.register(rateLimit, { max: 30, timeWindow: '1 minute' });

    puente.post<{ Body: { pase?: string } }>('/info', async (req, reply) => {
      const pase = await verPase(String(req.body?.pase ?? ''));
      if (!pase) {
        return reply.code(410).send({
          error: 'El enlace venció o ya se usó. Vuelve al CRM y pulsa «Conectar WhatsApp» otra vez.',
        });
      }
      return {
        organizacion: pase.organization.name,
        modo: pase.modo,
        volverA: pase.volverA,
        ...configPublica(),
      };
    });

    const cuerpoCompletar = z.object({
      pase: z.string().min(20),
      code: z.string().min(10),
      evento: z.string().max(80).optional(),
      wabaId: z.string().regex(/^\d+$/).optional(),
      phoneNumberId: z.string().regex(/^\d+$/).optional(),
    });

    puente.post('/completar', async (req, reply) => {
      const parsed = cuerpoCompletar.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
      try {
        return await completarAlta({ ...parsed.data, ip: req.ip });
      } catch (err) {
        const volverA = err instanceof ErrorAlta ? err.volverA : null;
        return reply.code(422).send({
          ok: false,
          error: err instanceof Error ? err.message : 'No se pudo completar la conexión.',
          volverA,
        });
      }
    });

    puente.post<{ Body: { pase?: string; evento?: Record<string, unknown> } }>('/evento', async (req) => {
      const evento = req.body?.evento && typeof req.body.evento === 'object' ? req.body.evento : {};
      await registrarFinSinCodigo(String(req.body?.pase ?? ''), evento);
      return { ok: true };
    });
  });

}
