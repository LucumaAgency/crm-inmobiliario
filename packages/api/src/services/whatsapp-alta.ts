/**
 * Botón «Conectar WhatsApp»: alta incrustada de Meta (Embedded Signup) y coexistencia.
 *
 * El cliente conecta su propio número con una ventana de Meta, sin que nadie de Lucuma
 * copie IDs ni tokens. Dos modos:
 *
 *  - **coexistencia**: el número sigue en la app WhatsApp Business del celular del asesor
 *    y además entra al CRM. Lo que escribe el asesor desde el teléfono llega por el
 *    webhook `smb_message_echoes` (ver `whatsapp-coexistencia.ts`). El número NO se
 *    registra: ya lo está.
 *  - **nuevo**: un número que vive solo en la API (el modo 2 de siempre). Hay que
 *    registrarlo con un PIN de verificación en dos pasos.
 *
 * Por qué hay una página puente en el dominio base: el SDK de Facebook solo abre el
 * registro desde los dominios autorizados en Meta, y se autorizó solo `APP_URL`
 * (crm.…) para no tocar Meta con cada cliente nuevo. Ese dominio no tiene la sesión del
 * cliente, así que el subdominio emite un **pase** de un solo uso (`WaAlta`) que la
 * página puente presenta junto con el código de Meta. El pase viaja en el fragmento de
 * la URL (`#pase=`), que el navegador no manda al servidor ni a terceros.
 */
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { cifrar, descifrar, redactarSecretos } from '../lib/secretos.js';
import { logError, logLine } from '../lib/log.js';
import { audit } from '../lib/auth.js';
import { enqueue } from '../lib/jobs.js';
import { llamarGraph } from './meta.js';
import { llamarCloud, suscribirAppAWaba } from './whatsapp.js';

export type ModoAlta = 'coexistencia' | 'nuevo';

const PASE_MINUTOS = 20;
/** Meta da 24 h desde el alta para pedir la sincronización; después hay que repetirla. */
export const PLAZO_SYNC_MS = 24 * 60 * 60 * 1000;

/** Eventos de fin de Meta que cuentan como alta terminada. */
const FINES = new Set([
  'FINISH',
  'FINISH_ONLY_WABA',
  'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',
  'FINISH_GRANT_ONLY_API_ACCESS',
]);

export function altaDisponible(): boolean {
  return !!(env.meta.appId && env.meta.appSecret && env.meta.waConfigId);
}

/** Datos públicos que la página puente necesita para iniciar el SDK. */
export function configPublica() {
  return {
    appId: env.meta.appId,
    configId: env.meta.waConfigId,
    graphVersion: env.meta.graphVersion,
  };
}

function hashDe(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ------------------------------------------------------------------ el pase

export async function crearPase(datos: {
  organizationId: string;
  userId: string;
  modo: ModoAlta;
  abrirLeads: boolean;
  ownerUserId: string | null;
  projectId: string | null;
  volverA: string;
}): Promise<{ url: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PASE_MINUTOS * 60 * 1000);
  await prisma.waAlta.create({
    data: {
      organizationId: datos.organizationId,
      userId: datos.userId,
      tokenHash: hashDe(token),
      modo: datos.modo,
      abrirLeads: datos.abrirLeads,
      ownerUserId: datos.ownerUserId,
      projectId: datos.projectId,
      volverA: datos.volverA.replace(/\/$/, ''),
      expiresAt,
    },
  });
  const base = env.appUrl.replace(/\/$/, '');
  return { url: `${base}/conectar-whatsapp#pase=${token}`, expiresAt };
}

/** El pase si vale (sin gastarlo): para que la página puente muestre a quién conecta. */
export async function verPase(token: string) {
  if (!token || token.length < 20) return null;
  const pase = await prisma.waAlta.findUnique({
    where: { tokenHash: hashDe(token) },
    include: { organization: { select: { name: true } } },
  });
  if (!pase || pase.usedAt || pase.expiresAt < new Date()) return null;
  return pase;
}

/**
 * Quema el pase. Un `updateMany` condicionado es atómico: si dos pestañas lo presentan a
 * la vez, solo una obtiene `count === 1`.
 */
async function gastarPase(token: string) {
  const tokenHash = hashDe(token);
  const r = await prisma.waAlta.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (r.count !== 1) return null;
  return prisma.waAlta.findUnique({ where: { tokenHash } });
}

// ------------------------------------------------------------- Graph API

/**
 * Canje del código del SDK. Sin `redirect_uri`: en el flujo del SDK de JavaScript Meta no
 * lo pide (a diferencia del botón de Lead Ads, que es una redirección). El código vive
 * 30 segundos, por eso esto es lo primero que se hace.
 */
async function canjearCodigoSdk(code: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${env.meta.graphVersion}/oauth/access_token`);
  url.searchParams.set('client_id', env.meta.appId);
  url.searchParams.set('client_secret', env.meta.appSecret);
  url.searchParams.set('code', code);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const cuerpo = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: { message?: string; code?: number };
  };
  if (!res.ok || cuerpo.error || !cuerpo.access_token) {
    throw new Error(
      `Meta no aceptó el código (${cuerpo.error?.message ?? `HTTP ${res.status}`}). ` +
        'El código vence a los 30 segundos: vuelve a intentarlo.'
    );
  }
  return cuerpo.access_token;
}

/** WABA concedida en el diálogo, cuando el evento del SDK no la trajo. */
async function wabaDelToken(token: string): Promise<string | null> {
  const debug = (await llamarGraph(
    'debug_token',
    { input_token: token },
    `${env.meta.appId}|${env.meta.appSecret}`
  )) as { data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> } };
  for (const g of debug.data?.granular_scopes ?? []) {
    if (g.scope === 'whatsapp_business_management' && g.target_ids?.length) return g.target_ids[0]!;
  }
  return null;
}

interface NumeroGraph {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  is_on_biz_app?: boolean;
  platform_type?: string;
}

const CAMPOS_NUMERO = 'id,display_phone_number,verified_name,is_on_biz_app,platform_type';

async function numerosDeWaba(wabaId: string, token: string): Promise<NumeroGraph[]> {
  const r = (await llamarCloud(`${wabaId}/phone_numbers?fields=${CAMPOS_NUMERO}`, token)) as {
    data?: NumeroGraph[];
  };
  return r.data ?? [];
}

async function datosDeNumero(phoneNumberId: string, token: string): Promise<NumeroGraph> {
  return (await llamarCloud(`${phoneNumberId}?fields=${CAMPOS_NUMERO}`, token)) as NumeroGraph;
}

/** Estado de coexistencia que reporta Meta. Lo usan «Probar conexión» y el diagnóstico. */
export async function estadoEnMeta(waNumberId: string) {
  const n = await prisma.waNumber.findUnique({ where: { id: waNumberId } });
  if (!n) return null;
  try {
    const d = await datosDeNumero(n.phoneNumberId, descifrar(n.accessTokenEnc));
    return { ok: true as const, isOnBizApp: d.is_on_biz_app ?? false, platformType: d.platform_type ?? null };
  } catch (err) {
    return { ok: false as const, error: redactarSecretos(err instanceof Error ? err.message : String(err)) };
  }
}

function formatearNumero(n: NumeroGraph): string {
  const crudo = n.display_phone_number ?? n.id;
  return crudo.startsWith('+') ? crudo : `+${crudo}`;
}

// ------------------------------------------------------------- completar

export interface DatosCompletar {
  pase: string;
  code: string;
  /** Lo que mandó Meta por `postMessage` (puede faltar si el navegador no lo entregó). */
  evento?: string;
  wabaId?: string;
  phoneNumberId?: string;
  ip?: string;
}

export interface ResultadoAlta {
  ok: boolean;
  volverA: string;
  numero?: string;
  coexistencia?: boolean;
  avisos: string[];
  error?: string;
}

export class ErrorAlta extends Error {
  constructor(mensaje: string, readonly volverA: string | null = null) {
    super(mensaje);
  }
}

export async function completarAlta(d: DatosCompletar): Promise<ResultadoAlta> {
  const pase = await gastarPase(d.pase);
  if (!pase) {
    throw new ErrorAlta('El enlace de conexión venció o ya se usó. Vuelve a pulsar «Conectar WhatsApp» en el CRM.');
  }
  const avisos: string[] = [];
  const registrar = async (resultado: Record<string, unknown>) => {
    await prisma.waAlta.update({ where: { id: pase.id }, data: { resultado: resultado as never } });
  };

  try {
    if (d.evento && !FINES.has(d.evento)) {
      throw new Error(`Meta terminó con «${d.evento}», no con un alta completa.`);
    }

    // 1) El código primero: vence en 30 s.
    const token = await canjearCodigoSdk(d.code);

    // 2) Cuenta y número. En coexistencia Meta solo manda la WABA en el evento.
    const wabaId = d.wabaId || (await wabaDelToken(token));
    if (!wabaId) throw new Error('Meta no indicó qué cuenta de WhatsApp se compartió.');

    let numero: NumeroGraph;
    if (d.phoneNumberId) {
      numero = await datosDeNumero(d.phoneNumberId, token);
    } else {
      const lista = await numerosDeWaba(wabaId, token);
      if (lista.length === 0) {
        throw new Error('La cuenta de WhatsApp se compartió sin ningún número. Repite el alta y elige o agrega el número.');
      }
      if (lista.length > 1) {
        // Se prefiere el que está en la app (coexistencia) o uno que aún no esté conectado.
        const libres = [];
        for (const n of lista) {
          const ya = await prisma.waNumber.findUnique({ where: { phoneNumberId: n.id } });
          if (!ya) libres.push(n);
        }
        const candidatos = (libres.length ? libres : lista).filter(
          (n) => pase.modo !== 'coexistencia' || n.is_on_biz_app
        );
        if (candidatos.length !== 1) {
          throw new Error(
            `La cuenta tiene varios números (${lista.map(formatearNumero).join(', ')}) y Meta no dijo cuál se conectó. ` +
              'Escríbenos para conectarlo a mano.'
          );
        }
        numero = candidatos[0]!;
      } else {
        numero = lista[0]!;
      }
    }

    const coexistencia = d.evento === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' || numero.is_on_biz_app === true;
    if (pase.modo === 'coexistencia' && !coexistencia) {
      avisos.push(
        'Se pidió conectar el número del celular, pero Meta lo conectó como número solo para la API. ' +
          'Desde ahora deja de funcionar en la app del teléfono.'
      );
    }

    // 3) El número no puede ser de otro cliente.
    const existente = await prisma.waNumber.findUnique({ where: { phoneNumberId: numero.id } });
    if (existente && existente.organizationId !== pase.organizationId) {
      throw new Error('Ese número ya está conectado en otra cuenta del CRM. Escríbenos.');
    }

    // 4) Webhooks de la WABA del cliente hacia nuestra app.
    const errorSuscripcion = await suscribirAppAWaba(wabaId, token);
    if (errorSuscripcion) avisos.push(`No se pudo suscribir la app a la cuenta: ${errorSuscripcion}`);

    // 5) Registro, solo para números que viven únicamente en la API.
    let pinEnc: string | null = existente?.pinEnc ?? null;
    if (!coexistencia && numero.platform_type !== 'CLOUD_API') {
      const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        await llamarCloud(`${numero.id}/register`, token, { messaging_product: 'whatsapp', pin });
        pinEnc = cifrar(pin);
      } catch (err) {
        avisos.push(
          `Meta no dejó registrar el número: ${redactarSecretos(err instanceof Error ? err.message : String(err))}. ` +
            'Si tiene verificación en dos pasos, hay que quitarla en el Administrador de WhatsApp y repetir el alta.'
        );
      }
    }

    // 6) Dueño y proyecto, validados contra la organización (el pase los trae del subdominio).
    const ownerUserId = pase.ownerUserId
      ? (
          await prisma.user.findFirst({
            where: { id: pase.ownerUserId, organizationId: pase.organizationId, active: true },
            select: { id: true },
          })
        )?.id ?? null
      : null;
    const projectId = pase.projectId
      ? (
          await prisma.project.findFirst({
            where: { id: pase.projectId, organizationId: pase.organizationId },
            select: { id: true },
          })
        )?.id ?? null
      : null;

    const ahora = new Date();
    const datos = {
      wabaId,
      displayNumber: formatearNumero(numero),
      accessTokenEnc: cifrar(token),
      active: true,
      origen: 'embedded_signup',
      coexistencia,
      abrirLeads: pase.abrirLeads,
      ownerUserId,
      pinEnc,
      onboardedAt: ahora,
      lastError: errorSuscripcion ? `No se pudo suscribir la app a la cuenta de WhatsApp: ${errorSuscripcion}` : null,
      // Un alta nueva habilita una sincronización nueva (Meta la permite una vez por alta).
      ...(coexistencia
        ? {
            syncContactosAt: null,
            syncHistorialAt: null,
            syncRequestIds: {} as never,
            syncError: null,
            historialEstado: 'pendiente',
            historialProgreso: null,
          }
        : {}),
    };
    const guardado = existente
      ? await prisma.waNumber.update({
          where: { id: existente.id },
          data: { ...datos, ...(projectId ? { projectId } : {}) },
        })
      : await prisma.waNumber.create({
          data: { organizationId: pase.organizationId, phoneNumberId: numero.id, projectId, ...datos },
        });

    if (coexistencia) await enqueue('wa.coex.sync', { waNumberId: guardado.id });

    await audit(pase.organizationId, pase.userId, 'whatsapp.connect', {
      entity: 'wa_number',
      entityId: guardado.id,
      meta: { via: 'embedded_signup', phoneNumberId: numero.id, wabaId, coexistencia, evento: d.evento ?? null },
      ip: d.ip,
    });
    logLine(
      `wa: alta incrustada ${numero.id} (${guardado.displayNumber}) en la organización ${pase.organizationId}` +
        `${coexistencia ? ' con coexistencia' : ''}`
    );
    await registrar({ ok: true, phoneNumberId: numero.id, wabaId, coexistencia, avisos });
    return { ok: true, volverA: pase.volverA, numero: guardado.displayNumber, coexistencia, avisos };
  } catch (err) {
    const mensaje = redactarSecretos(err instanceof Error ? err.message : String(err)).slice(0, 500);
    logError('wa: falló el alta incrustada', mensaje);
    await registrar({ ok: false, error: mensaje, evento: d.evento ?? null }).catch(() => undefined);
    throw new ErrorAlta(mensaje, pase.volverA);
  }
}

/** Deja constancia de un alta que terminó en Meta sin código (cancelada o con error). */
export async function registrarFinSinCodigo(token: string, evento: Record<string, unknown>) {
  const pase = await verPase(token);
  if (!pase) return;
  logLine(`wa: alta incrustada sin terminar en ${pase.organizationId}: ${JSON.stringify(evento).slice(0, 400)}`);
  await prisma.waAlta.update({
    where: { id: pase.id },
    data: { resultado: { ok: false, evento } as never },
  });
}

// ------------------------------------------------------ sincronización

/**
 * Pide a Meta los contactos y el historial del número en coexistencia.
 *
 * Cada tipo se puede pedir UNA vez por alta y dentro de 24 h. Si falla se lanza para que
 * la cola reintente (1, 5, 15, 60, 360 min: cabe en el plazo). Pasadas las 24 h no se
 * insiste: queda el error a la vista y hay que repetir el alta.
 */
export async function sincronizarCoexistencia(waNumberId: string): Promise<void> {
  const n = await prisma.waNumber.findUnique({ where: { id: waNumberId } });
  if (!n || !n.coexistencia || !n.active) return;
  if (n.syncContactosAt && n.syncHistorialAt) return;

  const vencido = n.onboardedAt && Date.now() - n.onboardedAt.getTime() > PLAZO_SYNC_MS;
  if (vencido) {
    await prisma.waNumber.update({
      where: { id: n.id },
      data: {
        syncError:
          'Pasaron las 24 horas que da Meta para sincronizar contactos e historial. ' +
          'Para traerlos hay que desconectar el número en la app y repetir el alta.',
      },
    });
    return;
  }

  const token = descifrar(n.accessTokenEnc);
  const ids = { ...((n.syncRequestIds ?? {}) as Record<string, string>) };
  const errores: string[] = [];

  const pedir = async (tipo: 'smb_app_state_sync' | 'history') => {
    try {
      const r = (await llamarCloud(`${n.phoneNumberId}/smb_app_data`, token, {
        messaging_product: 'whatsapp',
        sync_type: tipo,
      })) as { request_id?: string };
      if (r.request_id) ids[tipo] = r.request_id;
      return true;
    } catch (err) {
      const msg = redactarSecretos(err instanceof Error ? err.message : String(err));
      // Ya pedida antes (por un reintento que sí llegó a Meta): cuenta como hecha.
      if (/already|ya se/i.test(msg)) return true;
      errores.push(`${tipo}: ${msg}`);
      return false;
    }
  };

  const ahora = new Date();
  const contactos = n.syncContactosAt ? true : await pedir('smb_app_state_sync');
  const historial = n.syncHistorialAt ? true : await pedir('history');

  await prisma.waNumber.update({
    where: { id: n.id },
    data: {
      ...(contactos && !n.syncContactosAt ? { syncContactosAt: ahora } : {}),
      ...(historial && !n.syncHistorialAt
        ? { syncHistorialAt: ahora, historialEstado: n.historialEstado === 'pendiente' ? 'en_curso' : n.historialEstado }
        : {}),
      syncRequestIds: ids as never,
      syncError: errores.length ? errores.join(' · ').slice(0, 1000) : null,
    },
  });

  if (errores.length) throw new Error(`Sincronización de coexistencia incompleta: ${errores.join(' · ')}`);
  logLine(`wa: sincronización de coexistencia pedida para ${n.phoneNumberId} (${JSON.stringify(ids)})`);
}
