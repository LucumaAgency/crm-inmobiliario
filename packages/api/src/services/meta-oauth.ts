/**
 * «Conectar con Facebook»: la página del cliente entra al CRM sin tokens a mano.
 *
 * Es Facebook Login for Business con una configuración de tipo **usuario del sistema**:
 * el cliente elige su página en una ventana de Meta y el token que vuelve no depende de
 * la persona que hizo clic ni caduca. Detrás se hacen las mismas cuatro capas que antes
 * se hacían en el Explorador (`docs/META-LEAD-ADS.md`): página elegida, token de página,
 * app suscrita a la página y acceso a los leads, este último concedido en el propio
 * diálogo.
 *
 * Lo que este módulo NO hace es hablar con la sesión ni con la base más allá de
 * `MetaPage`: el `state` que ata el retorno de Meta a la organización lo firma y lo
 * comprueba aquí, y la ruta (`routes/meta-oauth.ts`) decide a dónde volver.
 */
import crypto from 'node:crypto';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { cifrar, redactarSecretos } from '../lib/secretos.js';
import { logLine } from '../lib/log.js';
import { llamarGraph, suscribirAppAPagina } from './meta.js';

/** Todo lo que el retorno de Meta necesita saber, firmado para que no se pueda inventar. */
export interface EstadoOAuth {
  organizationId: string;
  userId: string;
  projectId: string | null;
  /** Vuelve al host que empezó: con varios clientes, cada uno vive en su subdominio. */
  volverA: string;
  nonce: string;
  exp: number;
}

export function oauthDisponible(): boolean {
  return !!(env.meta.appId && env.meta.appSecret && env.meta.loginConfigId);
}

/** Ruta del callback; se registra tal cual en Meta, una por dominio del CRM. */
export function redirectUri(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/v1/meta/oauth/callback`;
}

// ------------------------------------------------------------------ state

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function firmaDe(cuerpo: string): string {
  return crypto.createHmac('sha256', env.jwtSecret).update(cuerpo).digest('base64url');
}

export function firmarEstado(estado: EstadoOAuth): string {
  const cuerpo = b64url(JSON.stringify(estado));
  return `${cuerpo}.${firmaDe(cuerpo)}`;
}

/**
 * Devuelve el estado si la firma vale, no venció y el nonce coincide con el de la cookie.
 *
 * El nonce en cookie es lo que impide el CSRF de OAuth: sin él, un tercero podría hacer
 * que un gerente conecte SU página al CRM del gerente enviándole un enlace de retorno
 * ya armado. Con el nonce, el retorno solo vale en el navegador que empezó.
 */
export function leerEstado(firmado: string | undefined, nonceCookie: string | undefined): EstadoOAuth | null {
  if (!firmado || !nonceCookie) return null;
  const [cuerpo, firma] = firmado.split('.');
  if (!cuerpo || !firma) return null;
  const esperada = firmaDe(cuerpo);
  if (firma.length !== esperada.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const estado = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8')) as EstadoOAuth;
    if (typeof estado.exp !== 'number' || estado.exp < Date.now()) return null;
    if (estado.nonce !== nonceCookie) return null;
    return estado;
  } catch {
    return null;
  }
}

export function nuevoNonce(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// ------------------------------------------------------------ el diálogo

export function urlDeAutorizacion(estadoFirmado: string, redirect: string): string {
  const url = new URL(`https://www.facebook.com/${env.meta.graphVersion}/dialog/oauth`);
  url.searchParams.set('client_id', env.meta.appId);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('state', estadoFirmado);
  url.searchParams.set('config_id', env.meta.loginConfigId);
  // Con una configuración de usuario del sistema, Meta exige el flujo por código.
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('override_default_response_type', 'true');
  return url.toString();
}

/** Canjea el `code` del retorno por el token de la integración. */
export async function canjearCodigo(code: string, redirect: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${env.meta.graphVersion}/oauth/access_token`);
  url.searchParams.set('client_id', env.meta.appId);
  url.searchParams.set('client_secret', env.meta.appSecret);
  url.searchParams.set('redirect_uri', redirect);
  url.searchParams.set('code', code);

  const control = new AbortController();
  const corte = setTimeout(() => control.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: control.signal });
    const cuerpo = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: { message?: string; code?: number };
    };
    if (!res.ok || cuerpo.error || !cuerpo.access_token) {
      throw new Error(
        `Graph API ${res.status}: ${cuerpo.error?.message ?? 'sin token en la respuesta'} (código ${cuerpo.error?.code ?? '?'})`
      );
    }
    return cuerpo.access_token;
  } finally {
    clearTimeout(corte);
  }
}

interface PaginaGraph {
  id: string;
  name: string;
  access_token: string;
}

/**
 * Páginas que el cliente autorizó en el diálogo, con su token de página.
 *
 * `/me/accounts` es el camino normal. Si viene vacío —pasa con algunos tokens de usuario
 * del sistema— se mira qué páginas concedió el diálogo (`granular_scopes` del
 * `debug_token`) y se pide el token de cada una directamente.
 */
export async function paginasAutorizadas(token: string): Promise<PaginaGraph[]> {
  const cuentas = (await llamarGraph('me/accounts', { fields: 'id,name,access_token', limit: '100' }, token)) as {
    data?: PaginaGraph[];
  };
  const lista = (cuentas.data ?? []).filter((p) => p.id && p.access_token);
  if (lista.length) return lista;

  const debug = (await llamarGraph(
    'debug_token',
    { input_token: token },
    `${env.meta.appId}|${env.meta.appSecret}`
  )) as {
    data?: { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> };
  };
  const ids = new Set<string>();
  for (const g of debug.data?.granular_scopes ?? []) {
    if (g.scope === 'pages_show_list' || g.scope === 'leads_retrieval') {
      for (const id of g.target_ids ?? []) ids.add(id);
    }
  }
  const salida: PaginaGraph[] = [];
  for (const id of ids) {
    try {
      const p = (await llamarGraph(id, { fields: 'id,name,access_token' }, token)) as Partial<PaginaGraph>;
      if (p.id && p.access_token) salida.push({ id: p.id, name: p.name ?? p.id, access_token: p.access_token });
    } catch (err) {
      logLine(`meta: no se pudo leer la página ${id} tras el login: ${String(err)}`);
    }
  }
  return salida;
}

export interface ResultadoConexion {
  conectadas: string[];
  /** Páginas que ya estaban en OTRA organización: no se tocan y no se dice cuál. */
  ajenas: string[];
  /** Guardadas, pero la suscripción de la app falló: los leads no llegarán hasta arreglarlo. */
  sinSuscribir: Array<{ nombre: string; error: string }>;
}

/**
 * Guarda (o renueva) cada página en la organización y suscribe la app.
 *
 * Una página que ya estaba conectada en esta misma organización se actualiza: es la
 * forma de renovar un token sin desconectar nada. Una que está en otra organización se
 * deja como está: el `pageId` es único en toda la instalación, y el diálogo de Meta no es
 * prueba suficiente de que la página cambió de dueño.
 */
export async function conectarPaginas(
  estado: EstadoOAuth,
  paginas: PaginaGraph[]
): Promise<ResultadoConexion> {
  const resultado: ResultadoConexion = { conectadas: [], ajenas: [], sinSuscribir: [] };

  for (const p of paginas) {
    const existente = await prisma.metaPage.findUnique({ where: { pageId: p.id } });
    if (existente && existente.organizationId !== estado.organizationId) {
      resultado.ajenas.push(p.name);
      continue;
    }

    const errorSuscripcion = await suscribirAppAPagina(p.id, p.access_token);
    const datos = {
      pageName: p.name,
      accessTokenEnc: cifrar(p.access_token),
      active: true,
      lastError: errorSuscripcion ? `No se pudo suscribir la app a la página: ${errorSuscripcion}` : null,
    };

    if (existente) {
      await prisma.metaPage.update({ where: { id: existente.id }, data: datos });
    } else {
      await prisma.metaPage.create({
        data: {
          organizationId: estado.organizationId,
          pageId: p.id,
          projectId: estado.projectId,
          ...datos,
        },
      });
    }
    resultado.conectadas.push(p.name);
    if (errorSuscripcion) resultado.sinSuscribir.push({ nombre: p.name, error: errorSuscripcion });
    logLine(`meta: página ${p.id} (${p.name}) conectada por OAuth en la organización ${estado.organizationId}`);
  }

  return resultado;
}

export function mensajeDeError(err: unknown): string {
  return redactarSecretos(err instanceof Error ? err.message : String(err)).slice(0, 300);
}
