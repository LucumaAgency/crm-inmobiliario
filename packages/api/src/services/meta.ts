/**
 * Meta Lead Ads: del aviso del webhook al lead en el CRM.
 *
 * El aviso de Meta **no trae los datos del lead**, solo un `leadgen_id`. Hay que ir a
 * buscarlos al Graph API con el token de la página. Son dos pasos separados a propósito:
 *
 *  1. El webhook (`routes/meta.ts`) solo registra el aviso y encola. Meta exige un 200 en
 *     pocos segundos y, si no lo recibe, reintenta y acaba desactivando la suscripción de
 *     la aplicación entera — es decir, un Graph API lento dejaría sin leads a TODOS los
 *     clientes. Responder rápido es un requisito, no una optimización.
 *  2. Este módulo hace la llamada, mapea y entra por `captureLead`, la misma puerta que
 *     el formulario web: así los leads de Meta heredan deduplicación, asignación por
 *     round robin, SLA y aviso por correo sin código propio.
 */
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { descifrar } from '../lib/secretos.js';
import { logLine } from '../lib/log.js';
import { partirNombre } from '../lib/nombres.js';
import { captureLead } from './capture.js';

export interface AvisoLeadgen {
  leadgenId: string;
  pageId: string;
  formId?: string;
  adId?: string;
  adgroupId?: string;
  createdTime?: number;
}

/** Campo del formulario instantáneo tal como lo devuelve el Graph API. */
interface CampoMeta {
  name: string;
  values: string[];
}

interface RespuestaLeadgen {
  id: string;
  created_time?: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  form_id?: string;
  platform?: string;
  field_data?: CampoMeta[];
}

/**
 * Registra el aviso y encola su procesado. Idempotente: el mismo `leadgen_id` dos veces
 * deja una sola fila y encola una sola vez.
 *
 * Devuelve `false` si el aviso se ignora (página desconocida o desactivada), para que el
 * webhook lo deje anotado en el log sin fallar: a Meta se le responde 200 igual, porque
 * un error nuestro repetido le hace desactivar la suscripción.
 */
export async function registrarAviso(aviso: AvisoLeadgen): Promise<boolean> {
  logLine(`meta: aviso de leadgen recibido (página ${aviso.pageId}, leadgen ${aviso.leadgenId})`);
  const pagina = await prisma.metaPage.findUnique({ where: { pageId: aviso.pageId } });
  if (!pagina || !pagina.active) {
    logLine(`meta: aviso de una página no registrada o inactiva (${aviso.pageId})`);
    return false;
  }

  try {
    await prisma.metaLead.create({
      data: {
        organizationId: pagina.organizationId,
        leadgenId: aviso.leadgenId,
        pageId: aviso.pageId,
        metaFormId: aviso.formId,
        adId: aviso.adId,
      },
    });
  } catch (err) {
    // P2002: ya estaba registrado. Es un reintento de Meta, no un lead nuevo.
    if ((err as { code?: string }).code === 'P2002') {
      logLine(`meta: aviso repetido, ignorado (leadgen ${aviso.leadgenId})`);
      return true;
    }
    throw err;
  }

  const { enqueue } = await import('../lib/jobs.js');
  await enqueue('meta.lead.fetch', { leadgenId: aviso.leadgenId });
  return true;
}

/**
 * Trae el lead de Meta y lo mete en el CRM. Lo llama la cola.
 *
 * Los fallos se propagan: la cola reintenta con backoff. Importa sobre todo para el token
 * vencido, que es el fallo típico de este canal y no se arregla solo — por eso queda
 * escrito en `lastError` de la página, para que se vea en el panel.
 */
export async function procesarLeadgen(leadgenId: string): Promise<void> {
  const registro = await prisma.metaLead.findUnique({ where: { leadgenId } });
  if (!registro) throw new Error(`meta: no hay registro del leadgen ${leadgenId}`);
  if (registro.status === 'procesado') return; // ya entró: la cola reintentó de más

  const pagina = await prisma.metaPage.findUnique({ where: { pageId: registro.pageId } });
  if (!pagina || !pagina.active) {
    await prisma.metaLead.update({
      where: { id: registro.id },
      data: { status: 'descartado', error: 'La página ya no está conectada' },
    });
    return;
  }

  let datos: RespuestaLeadgen;
  try {
    datos = await traerDelGraph(leadgenId, descifrar(pagina.accessTokenEnc));
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await prisma.$transaction([
      prisma.metaLead.update({
        where: { id: registro.id },
        data: { status: 'fallido', error: mensaje.slice(0, 1000) },
      }),
      prisma.metaPage.update({
        where: { id: pagina.id },
        data: { lastError: mensaje.slice(0, 1000) },
      }),
    ]);
    throw err; // que la cola reintente
  }

  const campos = mapear(datos.field_data ?? []);
  const projectId = proyectoDe(pagina, datos.form_id ?? registro.metaFormId ?? null);

  const resultado = await captureLead(
    {
      // Sin formId, `captureLead` no consulta su propia idempotencia; la de este canal
      // es el único de `leadgenId`, comprobado arriba y en `registrarAviso`.
      idempotencyKey: `meta-${leadgenId}`,
      values: campos.values,
      consent: {
        /**
         * En un formulario instantáneo el consentimiento lo recoge Meta, no nosotros: el
         * usuario acepta la política de privacidad del anunciante dentro de Facebook o
         * Instagram antes de enviar. Se deja constancia de de dónde viene y con qué
         * formulario, que es lo que hay que poder mostrar ante un reclamo (Ley 29733).
         */
        accepted: true,
        version: `meta:${datos.form_id ?? 'desconocido'}`,
        text: 'Aceptado en el formulario instantáneo de Meta (Facebook/Instagram)',
      },
      attribution: {
        last: limpiar({
          utm_source: datos.platform === 'ig' ? 'instagram' : 'facebook',
          utm_medium: 'paid_social',
          utm_campaign: datos.campaign_id,
          meta_ad_id: datos.ad_id,
          meta_adset_id: datos.adset_id,
          meta_form_id: datos.form_id,
          meta_leadgen_id: leadgenId,
        }),
      },
    },
    null,
    {
      organizationId: pagina.organizationId,
      projectId,
      source: 'meta_lead_ads',
      notifyEmails: Array.isArray(pagina.notifyEmails) ? (pagina.notifyEmails as string[]) : [],
    }
  );

  await prisma.$transaction([
    prisma.metaLead.update({
      where: { id: registro.id },
      data: {
        status: 'procesado',
        leadId: resultado.leadId,
        metaFormId: datos.form_id ?? registro.metaFormId,
        adsetId: datos.adset_id,
        campaignId: datos.campaign_id,
        platform: datos.platform,
        raw: datos as never,
        error: null,
        processedAt: new Date(),
      },
    }),
    prisma.metaPage.update({
      where: { id: pagina.id },
      data: { lastLeadAt: new Date(), lastError: null },
    }),
  ]);

  logLine(`meta: leadgen ${leadgenId} → lead ${resultado.leadId}`);
}

/**
 * Devuelve un token DE PÁGINA a partir de lo que pegue el usuario.
 *
 * El Explorador de Meta entrega por defecto un token de usuario, y cambiar el desplegable
 * a la página no regenera el de arriba: hay que volver a pulsar «Generate Access Token».
 * Es fácil copiar el de usuario creyendo que cambió, y entonces el Graph API responde
 * «(#190) This method must be called with a Page Access Token», que no dice en ningún
 * momento qué hacer. Pasó dos veces seguidas al conectar la primera página.
 *
 * Como el token de usuario ya contiene el permiso para obtener el de la página, el CRM lo
 * canjea solo en vez de exigir que lo haga la persona. Si lo que llega ya es de página, se
 * usa tal cual; si no se puede canjear, se guarda lo recibido y el error saldrá al probar
 * la conexión, que es donde se entiende.
 */
export async function resolverTokenDePagina(pageId: string, token: string): Promise<string> {
  try {
    const yo = (await llamarGraph('me', { fields: 'id' }, token)) as { id?: string };
    if (yo.id === pageId) return token; // ya es de página
  } catch {
    /* si ni siquiera se puede consultar, se intenta el canje igual */
  }

  try {
    const pagina = (await llamarGraph(pageId, { fields: 'access_token' }, token)) as {
      access_token?: string;
    };
    if (pagina.access_token) {
      logLine(`meta: token de usuario canjeado por el de la página ${pageId}`);
      return pagina.access_token;
    }
  } catch (err) {
    logLine(`meta: no se pudo canjear el token de la página ${pageId}: ${String(err)}`);
  }

  return token;
}

/**
 * Comprueba que el token de la página sigue vivo y lista sus formularios instantáneos.
 *
 * Los formularios se devuelven para poder armar el `formMap` sin copiar identificadores
 * a mano desde el administrador de anuncios, que es donde se cometen las erratas que
 * luego mandan los leads al proyecto equivocado.
 */
export async function probarPagina(pageId: string): Promise<{
  ok: boolean;
  error?: string;
  pageName?: string;
  forms?: Array<{ id: string; name: string; status?: string }>;
}> {
  const pagina = await prisma.metaPage.findUnique({ where: { pageId } });
  if (!pagina) return { ok: false, error: 'La página no está conectada' };

  try {
    const token = descifrar(pagina.accessTokenEnc);
    const info = (await llamarGraph(`${pageId}`, { fields: 'name' }, token)) as { name?: string };
    const formularios = (await llamarGraph(
      `${pageId}/leadgen_forms`,
      { fields: 'id,name,status', limit: '100' },
      token
    )) as { data?: Array<{ id: string; name: string; status?: string }> };

    await prisma.metaPage.update({ where: { id: pagina.id }, data: { lastError: null } });
    return { ok: true, pageName: info.name, forms: formularios.data ?? [] };
  } catch (err) {
    const mensaje = err instanceof Error ? err.message : String(err);
    await prisma.metaPage.update({
      where: { id: pagina.id },
      data: { lastError: mensaje.slice(0, 1000) },
    });
    return { ok: false, error: mensaje };
  }
}

// ---------------------------------------------------------------------------

function traerDelGraph(leadgenId: string, token: string): Promise<RespuestaLeadgen> {
  return llamarGraph(
    leadgenId,
    { fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,platform,field_data' },
    token
  ) as Promise<RespuestaLeadgen>;
}

/**
 * Llamada al Graph API.
 *
 * El corte a los 15 segundos es deliberado: sin `signal`, `fetch` espera indefinidamente
 * y un Graph API colgado dejaría el job bloqueado con su fila tomada hasta que venza el
 * candado, diez minutos después.
 */
async function llamarGraph(
  ruta: string,
  params: Record<string, string>,
  token: string
): Promise<unknown> {
  const url = new URL(`https://graph.facebook.com/${env.meta.graphVersion}/${ruta}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set('access_token', token);
  /**
   * `appsecret_proof` demuestra que la llamada sale de nuestra aplicación y no de alguien
   * que se hizo con el token. Meta lo exige si la app tiene activada esa opción, y con
   * ella activada un token robado no sirve fuera de aquí.
   */
  if (env.meta.appSecret) {
    url.searchParams.set(
      'appsecret_proof',
      crypto.createHmac('sha256', env.meta.appSecret).update(token).digest('hex')
    );
  }

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: control.signal });
    const cuerpo = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: number };
    };
    if (!res.ok || cuerpo.error) {
      const e = cuerpo.error;
      throw new Error(
        `Graph API ${res.status}: ${e?.message ?? 'sin detalle'} (código ${e?.code ?? '?'})`
      );
    }
    return cuerpo;
  } finally {
    clearTimeout(corte);
  }
}

/**
 * Nombres de campo de Meta → claves semánticas de `captureLead`.
 *
 * Los de la izquierda son los campos estándar de los formularios instantáneos; el
 * anunciante puede además añadir preguntas propias, cuyo `name` lo pone él. Lo que no se
 * reconoce NO se tira: va al mensaje, que es lo que lee el asesor antes de llamar.
 */
const CLAVES = {
  fname: 'fname',
  lname: 'lname',
  email: 'email',
  phone: 'phone',
  document: 'document',
  message: 'message',
} as const;

const ESTANDAR: Array<[RegExp, keyof typeof CLAVES]> = [
  [/^first_name$/, 'fname'],
  [/^last_name$/, 'lname'],
  [/^email$/, 'email'],
  [/^phone_number$/, 'phone'],
  // Meta usa varios nombres según el país para el documento de identidad.
  [/^(dni|id_number|national_id|documento)$/, 'document'],
];

function mapear(campos: CampoMeta[]): { values: Record<string, string> } {
  const values: Record<string, string> = {};
  const extras: string[] = [];

  for (const campo of campos) {
    const valor = (campo.values ?? []).filter(Boolean).join(', ').trim();
    if (!valor) continue;
    const nombre = campo.name.toLowerCase();

    if (nombre === 'full_name') {
      const { fname, lname } = partirNombre(valor);
      values.fname = fname;
      if (lname) values.lname = lname;
      continue;
    }

    const estandar = ESTANDAR.find(([re]) => re.test(nombre));
    if (estandar) {
      values[CLAVES[estandar[1]]] = valor;
      continue;
    }

    // Pregunta personalizada. El `name` de Meta viene en minúsculas y con guiones bajos.
    extras.push(`${campo.name.replace(/_/g, ' ')}: ${valor}`);
  }

  if (extras.length) values.message = extras.join('\n');
  return { values };
}

/** El formulario instantáneo manda sobre el proyecto por defecto de la página. */
function proyectoDe(
  pagina: { projectId: string | null; formMap: unknown },
  metaFormId: string | null
): string | null {
  if (metaFormId && pagina.formMap && typeof pagina.formMap === 'object') {
    const mapa = pagina.formMap as Record<string, unknown>;
    const valor = mapa[metaFormId];
    if (typeof valor === 'string' && valor) return valor;
  }
  return pagina.projectId ?? null;
}

function limpiar(o: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => typeof v === 'string' && v !== '')
  ) as Record<string, string>;
}

/** Exportados para las pruebas del mapeo. */
export { mapear as _mapearCamposMeta, proyectoDe as _proyectoDe };
