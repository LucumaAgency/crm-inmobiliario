import type { FastifyInstance, FastifyRequest } from 'fastify';
import { formSchema, submissionInput, type FormSchema, type PublicForm } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { hashKey, originAllowed } from '../lib/keys.js';
import { captureLead } from '../services/capture.js';

/**
 * API pública que consume el conector de WordPress.
 *
 * Dos llaves:
 *  - public key (cabecera X-LCRM-Key): leer el esquema y enviar submissions, solo desde
 *    los dominios autorizados del sitio.
 *  - secret key (cabecera X-LCRM-Secret): listar formularios y leer catálogos, server side.
 */
export default async function publicRoutes(app: FastifyInstance) {
  async function sitePorPublicKey(req: FastifyRequest) {
    const key = req.headers['x-lcrm-key'];
    if (typeof key !== 'string') return null;
    const site = await prisma.site.findUnique({ where: { publicKey: key } });
    if (!site || !site.active) return null;

    // La public key es pública a propósito: lo que protege es el dominio.
    const origin = (req.headers.origin as string | undefined) ?? undefined;
    const referer = req.headers.referer as string | undefined;
    const candidato = origin ?? referer;
    // Sin Origin (petición server-to-server desde el proxy del plugin) se acepta:
    // en ese caso no hay navegador que suplantar y el rate limit hace de tope.
    if (candidato && !originAllowed(candidato, site.allowedOrigins)) return null;
    return site;
  }

  async function sitePorSecret(req: FastifyRequest) {
    const key = req.headers['x-lcrm-secret'];
    if (typeof key !== 'string') return null;
    const hash = hashKey(key);
    return prisma.site.findFirst({ where: { secretKeyHash: hash, active: true } });
  }

  /** Esquema del formulario + opciones dinámicas ya resueltas. */
  app.get<{ Params: { id: string } }>('/forms/:id', async (req, reply) => {
    const site = (await sitePorPublicKey(req)) ?? (await sitePorSecret(req));
    if (!site) return reply.code(401).send({ error: 'Llave o dominio no autorizado' });

    const form = await prisma.form.findFirst({
      where: { id: req.params.id, organizationId: site.organizationId, active: true },
    });
    if (!form) return reply.code(404).send({ error: 'Formulario no encontrado' });

    const parsed = formSchema.safeParse(form.schema);
    if (!parsed.success) return reply.code(500).send({ error: 'Esquema del formulario inválido' });

    const out: PublicForm = {
      id: form.id,
      version: form.version,
      schema: parsed.data,
      dynamicOptions: await resolverOpciones(parsed.data, form.projectId),
    };
    // El conector cachea por form_id + version; el ETag ayuda a no traer lo mismo dos veces.
    reply.header('ETag', `W/"${form.id}-${form.version}"`);
    return out;
  });

  /** Lista de formularios del sitio, para el selector del elemento de Bricks. */
  app.get('/forms', async (req, reply) => {
    const site = await sitePorSecret(req);
    if (!site) return reply.code(401).send({ error: 'Secret key inválida' });
    const forms = await prisma.form.findMany({
      where: { organizationId: site.organizationId, active: true },
      select: { id: true, name: true, version: true, projectId: true },
      orderBy: { name: 'asc' },
    });
    return { forms };
  });

  /** Unidades disponibles, para el select dinámico y para mostrar disponibilidad en la web. */
  app.get<{ Querystring: { projectId?: string } }>('/units', async (req, reply) => {
    const site = (await sitePorPublicKey(req)) ?? (await sitePorSecret(req));
    if (!site) return reply.code(401).send({ error: 'Llave o dominio no autorizado' });
    const units = await prisma.unit.findMany({
      where: {
        project: { organizationId: site.organizationId, active: true },
        ...(req.query.projectId ? { projectId: req.query.projectId } : {}),
      },
      select: {
        id: true, code: true, typology: true, kind: true, status: true,
        bedrooms: true, areaM2: true, price: true, currency: true, projectId: true,
      },
      orderBy: { code: 'asc' },
    });
    return { units };
  });

  /** Recepción del formulario. Es la ruta crítica del producto. */
  app.post<{ Params: { id: string } }>('/forms/:id/submissions', async (req, reply) => {
    const site = await sitePorPublicKey(req);
    if (!site) return reply.code(401).send({ error: 'Llave o dominio no autorizado' });

    const parsed = submissionInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Datos inválidos', detail: parsed.error.flatten() });
    }

    const form = await prisma.form.findFirst({
      where: { id: req.params.id, organizationId: site.organizationId, active: true },
      include: { site: true },
    });
    if (!form) return reply.code(404).send({ error: 'Formulario no encontrado' });

    const schema = formSchema.safeParse(form.schema);
    if (!schema.success) return reply.code(500).send({ error: 'Esquema del formulario inválido' });

    // Consentimiento: obligatorio si el formulario lo exige (Ley 29733).
    if (schema.data.consent.required && !parsed.data.consent?.accepted) {
      return reply.code(400).send({ error: 'Falta la aceptación del tratamiento de datos' });
    }
    // Obligatorios declarados en el esquema.
    for (const f of schema.data.fields) {
      if (f.required && !String(parsed.data.values[f.key] ?? '').trim()) {
        return reply.code(400).send({ error: `El campo "${f.label}" es obligatorio` });
      }
    }

    const result = await captureLead(parsed.data, schema.data, {
      organizationId: site.organizationId,
      siteId: site.id,
      formId: form.id,
      formVersion: form.version,
      projectId: form.projectId,
      source: 'web_form',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      notifyEmails: Array.isArray(form.notifyEmails) ? (form.notifyEmails as string[]) : [],
    });

    return {
      ok: true as const,
      leadId: result.leadId,
      duplicated: result.duplicated,
      success: schema.data.success,
    };
  });
}

async function resolverOpciones(schema: FormSchema, projectIdForm: string | null) {
  const out: PublicForm['dynamicOptions'] = {};
  for (const field of schema.fields) {
    if (!field.source) continue;
    const projectId = field.source.projectId ?? projectIdForm ?? undefined;

    if (field.source.type === 'projects') {
      const projects = await prisma.project.findMany({
        where: { active: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      out[field.key] = projects.map((p) => ({ value: p.id, label: p.name }));
      continue;
    }
    if (!projectId) { out[field.key] = []; continue; }

    const units = await prisma.unit.findMany({
      where: {
        projectId,
        ...(field.source.onlyAvailable ? { status: 'disponible' } : {}),
        ...(field.source.excludeKinds?.length
          ? { kind: { notIn: field.source.excludeKinds as never[] } }
          : {}),
      },
      orderBy: { code: 'asc' },
    });

    if (field.source.type === 'typologies') {
      const vistas = new Set<string>();
      out[field.key] = units
        .filter((u) => u.typology && !vistas.has(u.typology) && vistas.add(u.typology))
        .map((u) => ({
          value: u.typology!,
          label: `${u.typology} · ${u.bedrooms ?? '?'} dorm · ${u.areaM2 ?? '?'} m²`,
        }));
    } else {
      out[field.key] = units.map((u) => ({
        value: u.id,
        label: `${u.code} · ${u.bedrooms ?? '?'} dorm · ${u.areaM2 ?? '?'} m²`,
      }));
    }
  }
  return out;
}
