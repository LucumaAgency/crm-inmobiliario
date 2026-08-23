/**
 * Worker de la cola de trabajos.
 *
 * Se invoca desde una tarea programada de Plesk (cada minuto):
 *     node /ruta/packages/api/dist/worker.js
 *
 * NO se usa setInterval dentro del proceso de la API: Passenger duerme la aplicación
 * cuando no hay tráfico, así que los temporizadores internos no son confiables justo
 * en las horas muertas, que es cuando más importa que el reintento ocurra.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from './db.js';
import { env } from './env.js';
import { logLine } from './lib/log.js';
import { backoffMinutes } from './lib/jobs.js';
import { newLeadEmail, sendMail } from './lib/mail.js';
import { leadUrl } from './services/capture.js';

const WORKER_ID = randomUUID();
const LOCK_VENCIDO_MIN = 10;

async function tomarLote() {
  const ahora = new Date();
  // Bloqueo optimista: dos ejecuciones solapadas no toman el mismo job.
  const candidatos = await prisma.job.findMany({
    where: {
      status: { in: ['pending', 'running'] },
      runAt: { lte: ahora },
      OR: [
        { lockedAt: null },
        { lockedAt: { lt: new Date(Date.now() - LOCK_VENCIDO_MIN * 60 * 1000) } },
      ],
    },
    orderBy: { runAt: 'asc' },
    take: env.workerBatch,
    select: { id: true },
  });

  const tomados: string[] = [];
  for (const c of candidatos) {
    const res = await prisma.job.updateMany({
      where: {
        id: c.id,
        OR: [
          { lockedAt: null },
          { lockedAt: { lt: new Date(Date.now() - LOCK_VENCIDO_MIN * 60 * 1000) } },
        ],
      },
      data: { status: 'running', lockedAt: ahora, lockedBy: WORKER_ID },
    });
    if (res.count === 1) tomados.push(c.id);
  }
  return prisma.job.findMany({ where: { id: { in: tomados } } });
}

async function procesar(job: { id: string; type: string; payload: unknown }) {
  switch (job.type) {
    case 'email.send':
      return enviarEmail(job.payload as Record<string, unknown>);
    case 'sla.check':
      return revisarSla(job.payload as { leadId: string });
    case 'retention.purge':
      return; // Fase 2: purga según política de retención
    case 'webhook.deliver':
      return; // Fase 2
    case 'conversion.push':
      return; // Fase 3: GA4 Measurement Protocol y Meta CAPI
    default:
      throw new Error(`Tipo de job desconocido: ${job.type}`);
  }
}

async function enviarEmail(payload: Record<string, unknown>) {
  if (payload.kind !== 'new_lead') return;
  const lead = await prisma.lead.findUnique({
    where: { id: String(payload.leadId) },
    include: {
      contact: true,
      project: { select: { name: true } },
      unit: { select: { code: true } },
      owner: { select: { email: true, name: true } },
    },
  });
  if (!lead) return;

  const destinatarios = new Set<string>(
    Array.isArray(payload.to) ? (payload.to as string[]) : []
  );
  if (lead.owner?.email) destinatarios.add(lead.owner.email);
  if (destinatarios.size === 0) return;

  const mail = newLeadEmail({
    contactName: `${lead.contact.fname} ${lead.contact.lname ?? ''}`.trim(),
    phone: lead.contact.phone,
    email: lead.contact.email,
    project: lead.project?.name,
    unit: lead.unit?.code,
    message: lead.message,
    url: leadUrl(lead.id),
  });
  await sendMail({ to: [...destinatarios], ...mail });
}

/** SLA de primer contacto: la conversión cae en picada después de la primera hora. */
async function revisarSla(payload: { leadId: string }) {
  const lead = await prisma.lead.findUnique({
    where: { id: payload.leadId },
    include: { owner: { select: { email: true, name: true } } },
  });
  if (!lead || lead.firstContactAt || lead.status !== 'activo') return;

  const minutos = Math.round((Date.now() - lead.createdAt.getTime()) / 60000);
  if (lead.owner?.email) {
    await sendMail({
      to: lead.owner.email,
      subject: `Lead sin contactar hace ${minutos} minutos`,
      html: `<p>Este lead sigue sin primer contacto.</p><p><a href="${leadUrl(lead.id)}">Abrirlo ahora</a></p>`,
    });
  }
  await prisma.activity.create({
    data: { leadId: lead.id, type: 'sistema', body: `Alerta de SLA: ${minutos} min sin contacto` },
  });
}

async function main() {
  const jobs = await tomarLote();
  if (jobs.length === 0) {
    await prisma.$disconnect();
    return;
  }
  logLine(`[worker ${WORKER_ID.slice(0, 8)}] procesando ${jobs.length} job(s)`);

  for (const job of jobs) {
    try {
      await procesar(job);
      await prisma.job.update({
        where: { id: job.id },
        data: { status: 'done', lockedAt: null, lockedBy: null },
      });
    } catch (err) {
      const intentos = job.attempts + 1;
      const agotado = intentos >= job.maxAttempts;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: agotado ? 'failed' : 'pending',
          attempts: intentos,
          lastError: err instanceof Error ? err.message : String(err),
          runAt: new Date(Date.now() + backoffMinutes(intentos) * 60 * 1000),
          lockedAt: null,
          lockedBy: null,
        },
      });
      logLine(`[worker] job ${job.id} (${job.type}) falló, intento ${intentos}:`, err);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  logLine('[worker] error fatal:', err);
  await prisma.$disconnect();
  process.exit(1);
});
