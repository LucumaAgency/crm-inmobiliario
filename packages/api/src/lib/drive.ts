/**
 * Google Drive para la copia externa de los respaldos.
 *
 * Un respaldo que vive solo en el mismo servidor no sirve el día que se pierde el servidor.
 * Cada respaldo diario se sube a una carpeta de Drive de Lucuma, una subcarpeta por
 * organización.
 *
 * Autenticación: OAuth de una cuenta de Google de Lucuma con el alcance `drive.file`, que
 * solo deja ver y tocar lo que esta aplicación creó (no el resto del Drive). El token de
 * actualización se saca una vez con `scripts/drive-token.mjs` y va en el entorno. No se usa
 * una cuenta de servicio: desde 2025 esas cuentas no tienen cuota en un Drive personal y
 * la subida falla salvo en una unidad compartida de Workspace.
 *
 * Con `drive.file` la aplicación no ve carpetas creadas a mano, así que la carpeta raíz la
 * crea ella misma la primera vez (`GDRIVE_CARPETA`, por defecto «Respaldos CRM Lucuma») y
 * la vuelve a encontrar por nombre.
 */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { env } from '../env.js';

const API = 'https://www.googleapis.com/drive/v3';
const SUBIDA = 'https://www.googleapis.com/upload/drive/v3';
const CARPETA = 'application/vnd.google-apps.folder';

export function driveConfigurado() {
  const d = env.drive;
  return !!(d.clientId && d.clientSecret && d.refreshToken);
}

let cache: { token: string; vence: number } | null = null;

async function token(): Promise<string> {
  if (cache && cache.vence > Date.now() + 60_000) return cache.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.drive.clientId,
      client_secret: env.drive.clientSecret,
      refresh_token: env.drive.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const j = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) {
    // invalid_grant = token revocado o vencido (la app de OAuth quedó en modo «Prueba»).
    throw new Error(`Google rechazó el token de Drive: ${j.error ?? res.status} ${j.error_description ?? ''}`.trim());
  }
  cache = { token: j.access_token, vence: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cache.token;
}

async function llamar<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const comillas = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export interface ArchivoDrive {
  id: string;
  name: string;
  size?: string;
  createdTime: string;
}

/** Lista lo que hay en una carpeta (solo lo que creó esta aplicación). */
export async function listar(carpetaId: string): Promise<ArchivoDrive[]> {
  const salida: ArchivoDrive[] = [];
  let pagina: string | undefined;
  do {
    const q = new URLSearchParams({
      q: `'${carpetaId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, size, createdTime)',
      pageSize: '200',
      ...(pagina ? { pageToken: pagina } : {}),
    });
    const r = await llamar<{ files: ArchivoDrive[]; nextPageToken?: string }>(`${API}/files?${q}`);
    salida.push(...r.files);
    pagina = r.nextPageToken;
  } while (pagina);
  return salida;
}

/** Busca una carpeta por nombre (dentro de `padre`, o en la raíz) y la crea si no existe. */
export async function carpeta(nombre: string, padre?: string): Promise<string> {
  const q = new URLSearchParams({
    q: `name = '${comillas(nombre)}' and mimeType = '${CARPETA}' and trashed = false${padre ? ` and '${padre}' in parents` : ''}`,
    fields: 'files(id)',
  });
  const r = await llamar<{ files: { id: string }[] }>(`${API}/files?${q}`);
  if (r.files[0]) return r.files[0].id;
  const nueva = await llamar<{ id: string }>(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombre, mimeType: CARPETA, ...(padre ? { parents: [padre] } : {}) }),
  });
  return nueva.id;
}

/** Carpeta de una organización: `<raíz>/<slug>`. */
export async function carpetaDeOrg(slug: string): Promise<string> {
  return carpeta(slug, await carpeta(env.drive.carpeta));
}

/**
 * Sube un archivo con una subida reanudable, en streaming: un respaldo con audios y
 * proformas puede pesar decenas de MB y no hace falta tenerlo entero en memoria.
 */
export async function subir(rutaLocal: string, nombre: string, carpetaId: string): Promise<{ id: string }> {
  const bytes = fs.statSync(rutaLocal).size;
  const inicio = await fetch(`${SUBIDA}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'application/zip',
      'X-Upload-Content-Length': String(bytes),
    },
    body: JSON.stringify({ name: nombre, parents: [carpetaId] }),
  });
  const destino = inicio.headers.get('location');
  if (!inicio.ok || !destino) throw new Error(`Drive no abrió la subida (${inicio.status}): ${(await inicio.text()).slice(0, 300)}`);

  const res = await fetch(destino, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/zip', 'Content-Length': String(bytes) },
    body: Readable.toWeb(fs.createReadStream(rutaLocal)) as unknown as RequestInit["body"],
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  if (!res.ok) throw new Error(`Drive rechazó la subida (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as { id: string };
}

/** Borra para siempre (no a la papelera): son respaldos vencidos por la política de retención. */
export async function borrar(id: string) {
  await llamar<void>(`${API}/files/${id}`, { method: 'DELETE' });
}
