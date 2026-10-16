/**
 * Migración desde Sperant, desde Ajustes → Migración Sperant.
 *
 * Todo bajo `canales.configurar` o `usuarios.gestionar`: es una operación de gerencia. El
 * token nunca sale por la API (solo su pista). Lógica en `services/sperant.ts`.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { guardarAjustes, leerAjustes } from '../lib/ajustes.js';
import { audit, requirePermiso } from '../lib/auth.js';
import { cifrar, pista } from '../lib/secretos.js';
import {
  asesoresSperant,
  borrarDatos,
  completarDatos,
  hayDatos,
  importar,
  iniciarExportacion,
  iniciarImportacion,
  leerEstado,
  probar,
  reasignarPorAsesor,
  resumen,
  sugerirMapa,
  tareaEnCurso,
  type MapaImporte,
} from '../services/sperant.js';

export default async function sperantRoutes(app: FastifyInstance) {
  const guardia = requirePermiso('canales.configurar', 'usuarios.gestionar');

  /** Estado completo para la pantalla: config, tarea en curso, resumen y mapa sugerido. */
  app.get('/estado', { preHandler: guardia }, async (req) => {
    const org = req.user!.organizationId;
    const a = await leerAjustes(org);
    const estado = leerEstado(org);
    const tieneToken = !!a.sperant?.tokenCifrado;
    const fase = estado.fase === 'sin_token' && tieneToken ? 'listo' : estado.fase;
    const datos = hayDatos(org);
    return {
      config: { tokenHint: pista(a.sperant?.tokenCifrado), sperantProjectId: a.sperant?.sperantProjectId ?? null },
      estado: { ...estado, fase, enCurso: tareaEnCurso(org), hayDatos: datos },
      resumen: datos ? resumen(org) : null,
      sugerencia: datos ? await sugerirMapa(org) : null,
      proyectosCrm: await prisma.project.findMany({ where: { organizationId: org }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    };
  });

  app.put('/config', { preHandler: guardia }, async (req, reply) => {
    const parsed = z
      .object({ token: z.string().trim().min(10).optional(), sperantProjectId: z.number().int().positive().nullable().optional() })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const org = req.user!.organizationId;
    const actual = (await leerAjustes(org)).sperant ?? { tokenCifrado: null, sperantProjectId: null };
    const sperant = {
      tokenCifrado: parsed.data.token ? cifrar(parsed.data.token) : actual.tokenCifrado,
      sperantProjectId: parsed.data.sperantProjectId === undefined ? actual.sperantProjectId : parsed.data.sperantProjectId,
    };
    await guardarAjustes(org, { sperant });
    await audit(org, req.user!.id, 'sperant.config', { meta: { tokenCambiado: !!parsed.data.token, sperantProjectId: sperant.sperantProjectId } });
    return { ok: true, tokenHint: pista(sperant.tokenCifrado), sperantProjectId: sperant.sperantProjectId };
  });

  app.post('/probar', { preHandler: guardia }, async (req, reply) => {
    try {
      return await probar(req.user!.organizationId);
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/exportar', { preHandler: guardia }, async (req, reply) => {
    const org = req.user!.organizationId;
    try {
      await iniciarExportacion(org);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
    await audit(org, req.user!.id, 'sperant.exportar');
    return reply.code(202).send({ ok: true });
  });

  const mapaInput = z.object({
    simulacion: z.boolean().default(true),
    crmProjectId: z.string().min(1),
    etapas: z.record(z.string().nullable()),
    asesores: z.record(z.string().nullable()),
    importarUnidades: z.boolean().default(true),
    importarProformas: z.boolean().default(true),
    unidadesAprobadas: z.array(z.string()).optional(),
  });

  /**
   * Simulación: responde en la misma petición con el informe (solo lecturas, unos segundos).
   * Importación real: arranca en segundo plano y devuelve 202; el avance va por /estado.
   */
  app.post('/importar', { preHandler: guardia }, async (req, reply) => {
    const parsed = mapaInput.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const org = req.user!.organizationId;
    const { simulacion, ...mapa } = parsed.data;
    const m: MapaImporte = { ...mapa, userId: req.user!.id };
    if (!hayDatos(org)) return reply.code(409).send({ error: 'Primero hay que exportar' });
    if (tareaEnCurso(org)) return reply.code(409).send({ error: 'Ya hay una tarea en curso' });
    try {
      if (simulacion) return await importar(org, m, true);
      await iniciarImportacion(org, m);
      await audit(org, req.user!.id, 'sperant.importar', { meta: { crmProjectId: m.crmProjectId } });
      return reply.code(202).send({ ok: true });
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Completa los leads ya importados con la ficha completa de Sperant (simular o aplicar). */
  app.post('/completar', { preHandler: guardia }, async (req, reply) => {
    const parsed = z.object({ simulacion: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Datos inválidos' });
    const org = req.user!.organizationId;
    if (!hayDatos(org)) return reply.code(409).send({ error: 'Primero hay que exportar' });
    if (tareaEnCurso(org)) return reply.code(409).send({ error: 'Ya hay una tarea en curso' });
    try {
      const informe = await completarDatos(org, parsed.data.simulacion);
      if (!parsed.data.simulacion) await audit(org, req.user!.id, 'sperant.completar', { meta: informe });
      return informe;
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Asesores de Sperant en los leads importados y quién los tiene hoy. */
  app.get('/asesores', { preHandler: guardia }, async (req) => asesoresSperant(req.user!.organizationId));

  /**
   * Reparte los leads importados según su asesor en Sperant, creando usuarios si hace falta.
   * Crear usuarios exige `usuarios.gestionar` aunque la pantalla también la vea `canales`.
   */
  app.post('/reasignar', { preHandler: requirePermiso('usuarios.gestionar') }, async (req, reply) => {
    const parsed = z
      .object({
        asignaciones: z
          .array(
            z.object({
              username: z.string().min(1),
              userId: z.string().optional(),
              crear: z.object({ name: z.string().trim().min(1).max(100), email: z.string().email(), role: z.enum(['asesor', 'gerente']) }).optional(),
            })
          )
          .min(1),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Revisa nombre y correo de cada usuario nuevo' });
    const org = req.user!.organizationId;
    if (tareaEnCurso(org)) return reply.code(409).send({ error: 'Hay una tarea en curso' });
    try {
      return { resultado: await reasignarPorAsesor(org, req.user!.id, parsed.data.asignaciones) };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /** Borra el export (datos personales) cuando la migración terminó. */
  app.delete('/datos', { preHandler: guardia }, async (req, reply) => {
    const org = req.user!.organizationId;
    if (tareaEnCurso(org)) return reply.code(409).send({ error: 'Hay una tarea en curso' });
    borrarDatos(org);
    await audit(org, req.user!.id, 'sperant.borrar_datos');
    return { ok: true };
  });
}
