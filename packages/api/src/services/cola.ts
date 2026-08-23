/**
 * Procesado de la cola de trabajos.
 *
 * Se ejecuta desde dos sitios, con la misma lógica:
 *
 *  1. `worker.ts`, invocado por una tarea programada. Es el mecanismo completo:
 *     también despacha lo que vence más tarde (alertas de SLA, reintentos con espera).
 *  2. **En línea**, dentro del proceso de la API, disparado al encolar un trabajo que
 *     ya está vencido (ver `lib/jobs.ts`).
 *
 * El punto 2 no contradice la decisión #17 («jobs por worker, no setInterval»): lo que
 * aquella rechazaba es un temporizador interno, que no sirve porque Passenger duerme la
 * aplicación cuando no hay tráfico. Esto no es un temporizador, es un disparo atado a un
 * evento real, y el evento garantiza que el proceso está vivo justo en ese instante: si
 * está entrando un lead, hay tráfico por definición.
 *
 * Lo que el disparo en línea NO cubre, y por lo que la tarea programada sigue siendo el
 * mecanismo preferente: los trabajos con espera. Una alerta de SLA a los 15 minutos
 * necesita que alguien despierte a la aplicación entonces, y nadie garantiza que haya
 * tráfico en ese momento.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logError, logLine } from '../lib/log.js';
import { backoffMinutes } from '../lib/jobs.js';
import { newLeadEmail, sendMail } from '../lib/mail.js';
import { leadUrl } from './capture.js';

const EJECUTOR_ID = randomUUID();
const LOCK_VENCIDO_MIN = 10;

async function tomarLote() {
  const ahora = new Date();
  // Bloqueo optimista: dos ejecuciones solapadas no toman el mismo job. Importa más
  // que nunca ahora que puede haber una tarea programada y un disparo en línea a la vez.
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
      data: { status: 'running', lockedAt: ahora, lockedBy: EJECUTOR_ID },
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

  /**
   * Un envío por destinatario, no uno solo con todos.
   *
   * Con un único envío, basta que el servidor de correo rechace UNA dirección para que
   * se caiga la transacción entera y no reciba nadie. Pasó en la puesta en marcha: el
   * asesor de ejemplo del seed tenía un dominio inexistente y eso dejaba sin aviso
   * también a los destinatarios buenos del formulario. Un aviso de lead es lo último que
   * puede depender de que todas las direcciones estén bien.
   *
   * Efecto secundario deseable: los destinatarios no se ven entre sí.
   */
  const fallos: string[] = [];
  for (const destinatario of destinatarios) {
    try {
      await sendMail({ to: destinatario, ...mail });
    } catch (err) {
      fallos.push(`${destinatario}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fallos.length === destinatarios.size) {
    // Ninguno salió: probablemente el servidor de correo está caído, no las direcciones.
    // Se lanza para que el job se reintente con backoff.
    throw new Error(`No se pudo avisar a ningún destinatario. ${fallos.join(' | ')}`);
  }
  if (fallos.length) {
    logError(`[cola] aviso del lead ${lead.id} no llegó a ${fallos.length} destinatario(s):`, fallos.join(' | '));
  }
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

/** Procesa un lote. Devuelve cuántos trabajos tomó. */
export async function procesarCola(): Promise<number> {
  const jobs = await tomarLote();
  if (jobs.length === 0) return 0;
  logLine(`[cola ${EJECUTOR_ID.slice(0, 8)}] procesando ${jobs.length} job(s)`);

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
      logError(`[cola] job ${job.id} (${job.type}) falló, intento ${intentos}:`, err);
    }
  }
  return jobs.length;
}

// --------------------------------------------------------- disparo en línea

const MAX_VUELTAS = 5;
let enLinea = true;
let enMarcha = false;
let repetir = false;

/** El proceso del worker no debe redisparar en línea: ya está procesando. */
export function desactivarEnLinea() {
  enLinea = false;
}

/**
 * Pide procesar la cola sin bloquear a quien llama.
 *
 * No se espera el resultado a propósito: quien dispara esto es una petición HTTP que
 * está respondiendo a un visitante, y el envío del correo no puede retrasar la respuesta
 * del formulario. Si falla, se registra y el trabajo se queda encolado para el siguiente
 * intento; nunca hace fracasar la captura del lead.
 */
export function dispararCola() {
  if (!enLinea || !env.workerInline) return;
  if (enMarcha) {
    // Ya hay una vuelta en curso: se marca para que dé otra al terminar, en vez de
    // lanzar procesados en paralelo que competirían por los mismos trabajos.
    repetir = true;
    return;
  }
  enMarcha = true;
  setImmediate(() => {
    void bucle();
  });
}

async function bucle() {
  try {
    do {
      repetir = false;
      let vueltas = 0;
      let tomados = 0;
      do {
        tomados = await procesarCola();
        vueltas += 1;
      } while (tomados > 0 && vueltas < MAX_VUELTAS);
    } while (repetir);
  } catch (err) {
    logError('[cola] fallo del disparo en línea:', err);
  } finally {
    enMarcha = false;
  }
}
