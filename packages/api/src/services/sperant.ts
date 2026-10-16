/**
 * Migración desde Sperant (API v3), manejada desde el CRM.
 *
 * Tres pasos, cada uno con su endpoint en `routes/sperant.ts`:
 *
 *  1. **Probar**: con el token guardado, listar proyectos y contar leads.
 *  2. **Exportar**: bajar todo a `privados/<org>/sperant/datos.json`. El listado de clientes
 *     solo trae 8 columnas, así que hacen falta DOS peticiones por lead (detalle y relación
 *     con el proyecto, donde viven etapa, asesor, canal y medio). Para 1.700 leads son unos
 *     25 minutos. Por eso la exportación NO va por la cola de trabajos (bloquearía los envíos
 *     de WhatsApp detrás de ella): corre como tarea desprendida dentro del proceso, guarda el
 *     avance cada pocos leads y **se reanuda** donde quedó si el proceso muere.
 *  3. **Importar**: con un mapa de etapas y asesores decidido por la persona, crear contactos
 *     y leads con su fecha original. Primero en modo simulación (no escribe), luego de verdad.
 *     Es idempotente: cada lead guarda su `client_id` de Sperant en `attribution.sperant`, y
 *     volver a correrlo solo trae los que faltan (lo que permite el corte final tras el
 *     paralelo).
 *
 * Lo que se aprendió de la API el 2026-10-15 está en `docs/25-MIGRACION-SPERANT.md`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { normalizeDocument, normalizeEmail, normalizePhonePE } from '@lucuma-crm/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { leerAjustes } from '../lib/ajustes.js';
import { logError, logLine } from '../lib/log.js';
import { privadosDir } from '../lib/privados.js';
import { guardar as guardarMedia } from '../lib/media.js';
import { descifrar } from '../lib/secretos.js';
import { upsertContacto } from './capture.js';

const BASE = 'https://api.sperant.com';
/** Límite de Sperant: 15 req/s. Se va a 5 para no competir con el plugin de la web. */
const PAUSA_MS = 200;
/** Cada cuántos leads se guarda el avance (y se actualiza el latido). */
const CADA = 20;
/** Si el latido tiene más de esto, la tarea se da por muerta y se puede reanudar. */
const LATIDO_MUERTO_MS = 3 * 60 * 1000;

// ------------------------------------------------------------------ tipos

type Plano = Record<string, unknown>;

export interface DatosExport {
  version: 1;
  exportadoEl: string;
  catalogos: Record<string, Plano[]>;
  projects: Plano[];
  types: Plano[];
  units: Plano[];
  users: Plano[];
  /** Listado crudo de /v3/clients (8 columnas). Es la lista de trabajo. */
  clientes: Plano[];
  /** /v3/clients/{id}, por id. */
  detalle: Record<string, Plano>;
  /** /v3/clients/{id}/projects, por id (puede ser varios; en Bastión siempre uno). */
  proyectos: Record<string, Plano[]>;
  /** /v3/budgets con titulares y unidades. */
  budgets: Plano[];
  /** /v3/projects/{id}: ubicación, construcción, garantías, redes. Desde 2026-10-16. */
  proyectoDetalle?: Plano | null;
  /** /v3/projects/{id}/images (renders del proyecto). */
  proyectoImagenes?: Plano[];
  /** /v3/units/{id} por id: piso, áreas techada/libre, vista, dormitorios, fechas. */
  unidadesDetalle?: Record<string, Plano>;
  /** Proyecto de Sperant del que salieron tipologías y unidades (exports de un solo proyecto). */
  inventarioDe?: { id: number; nombre: string } | null;
  /** Nombres de tipologías de los OTROS proyectos de la cuenta (para limpiar las que se colaron). */
  tiposOtrosProyectos?: string[];
  /** Desde 2026-10-16: inventario de TODOS los proyectos de la cuenta, por id de Sperant. */
  inventarios?: Record<string, InventarioSp>;
}

export interface InventarioSp {
  id: number;
  nombre: string;
  codigo: string | null;
  detalle: Plano | null;
  imagenes: Plano[];
  types: Plano[];
  units: Plano[];
  unidadesDetalle: Record<string, Plano>;
}

/**
 * Inventarios del export. Los exports de antes (un solo proyecto, en `types`/`units`) se
 * leen como uno solo si se sabe de qué proyecto son; si no, no se usan: adivinar fue lo que
 * metió Bordeaux en Domus.
 */
function inventariosDe(d: DatosExport): InventarioSp[] {
  if (d.inventarios) return Object.values(d.inventarios);
  const pid = d.inventarioDe?.id ?? (d.projects.length === 1 ? Number(d.projects[0].id) : null);
  if (!pid || !d.units.length) return [];
  const p = d.projects.find((x) => Number(x.id) === pid);
  return [{
    id: pid, nombre: String(p?.name ?? pid), codigo: p?.code ? String(p.code) : null, detalle: d.proyectoDetalle ?? null,
    imagenes: d.proyectoImagenes ?? [], types: d.types, units: d.units, unidadesDetalle: d.unidadesDetalle ?? {},
  }];
}

export type Fase = 'sin_token' | 'listo' | 'exportando' | 'exportado' | 'importando' | 'importado' | 'error';

export interface Estado {
  fase: Fase;
  /** Qué tarea corre (o corrió): exportar | importar. */
  tarea?: 'exportar' | 'importar';
  inicio?: string;
  fin?: string;
  latido?: string;
  total?: number;
  hechos?: number;
  error?: string | null;
  /** Resultado de la última importación real. */
  importe?: InformeImporte;
  /** Proyecto de Sperant → proyecto del CRM de la última importación real (lo usa «Completar»). */
  mapaProyectos?: Record<string, string>;
}

export interface MapaImporte {
  /**
   * Proyecto de Sperant (id) → proyecto del CRM (id), `crear` (uno nuevo con su nombre) o
   * null (no se importa: ni sus leads ni su inventario).
   */
  proyectos: Record<string, string | null>;
  /** segment_name de Sperant → id de etapa del CRM, `crear`, `crear_perdida` o null (omitir el lead). */
  etapas: Record<string, string | null>;
  /** seller_username de Sperant → id de usuario del CRM, o null (sin dueño). */
  asesores: Record<string, string | null>;
  importarUnidades: boolean;
  importarProformas: boolean;
  /**
   * Códigos de unidades cuyos cambios se aprueban. Una unidad que ya existe en el CRM y
   * difiere de Sperant SOLO se actualiza si su código está aquí: la simulación devuelve la
   * comparativa (`unidades.diferencias`) y la persona aprueba una por una. Las unidades
   * nuevas se crean siempre; las iguales no se tocan.
   */
  unidadesAprobadas?: string[];
  /** Quién aprueba (para la auditoría de precios). */
  userId?: string | null;
}

export interface DiferenciaUnidad {
  /** `idProyectoSperant:código`: el mismo código (201) puede existir en dos proyectos. */
  clave: string;
  proyecto: string;
  code: string;
  /** Campos que difieren: campo → { crm, sperant }. */
  cambios: Record<string, { crm: string | number | null; sperant: string | number | null }>;
  aprobada: boolean;
}

export interface InformeImporte {
  simulacion: boolean;
  leads: {
    total: number;
    nuevos: number;
    fusionados: number;
    yaImportados: number;
    omitidos: number;
    sinEtapa: number;
    sinAsesor: number;
    /** Del proyecto marcado «no importar». */
    deProyectoNoImportado: number;
    /** Sin proyecto en el export (la petición falló): exportar de nuevo los trae. */
    sinProyecto: number;
    errores: number;
  };
  proyectos: { sperant: string; crm: string | null; creado: boolean; leads: number; unidades: number }[];
  contactos: { nuevos: number; existentes: number };
  unidades: { creadas: number; actualizadas: number; sinCambios: number; pendientes: number; tipologiasCreadas: number; diferencias: DiferenciaUnidad[] };
  proformas: { notas: number };
  etapasCreadas: string[];
  erroresDetalle: { clientId: number; motivo: string }[];
  fin?: string;
}

// ------------------------------------------------------------------ archivos

function dir(organizationId: string) {
  const d = path.join(privadosDir, organizationId, 'sperant');
  fs.mkdirSync(d, { recursive: true });
  return d;
}
const rutaEstado = (org: string) => path.join(dir(org), 'estado.json');
const rutaDatos = (org: string) => path.join(dir(org), 'datos.json');

export function leerEstado(organizationId: string): Estado {
  try {
    return JSON.parse(fs.readFileSync(rutaEstado(organizationId), 'utf8')) as Estado;
  } catch {
    return { fase: 'sin_token' };
  }
}

function guardarEstado(organizationId: string, estado: Estado) {
  fs.writeFileSync(rutaEstado(organizationId), JSON.stringify(estado, null, 1));
}

function leerDatos(organizationId: string): DatosExport | null {
  try {
    return JSON.parse(fs.readFileSync(rutaDatos(organizationId), 'utf8')) as DatosExport;
  } catch {
    return null;
  }
}

function guardarDatos(organizationId: string, datos: DatosExport) {
  // Escritura atómica: si el proceso muere a mitad, queda la versión anterior y no un JSON roto.
  const tmp = rutaDatos(organizationId) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos));
  fs.renameSync(tmp, rutaDatos(organizationId));
}

export function hayDatos(organizationId: string) {
  return fs.existsSync(rutaDatos(organizationId));
}

/** Borra el export (datos personales) una vez terminada la migración. */
export function borrarDatos(organizationId: string) {
  for (const f of [rutaDatos(organizationId), rutaDatos(organizationId) + '.tmp']) {
    try { fs.unlinkSync(f); } catch { /* no existía */ }
  }
  const e = leerEstado(organizationId);
  guardarEstado(organizationId, { fase: 'listo', importe: e.importe });
}

/** ¿Hay una tarea viva? Viva = en marcha y con latido reciente. */
export function tareaEnCurso(organizationId: string) {
  const e = leerEstado(organizationId);
  if (e.fase !== 'exportando' && e.fase !== 'importando') return false;
  const latido = e.latido ? Date.parse(e.latido) : 0;
  return Date.now() - latido < LATIDO_MUERTO_MS;
}

// ------------------------------------------------------------------ cliente HTTP

async function token(organizationId: string) {
  const a = await leerAjustes(organizationId);
  if (!a.sperant?.tokenCifrado) throw new Error('No hay token de Sperant guardado');
  return descifrar(a.sperant.tokenCifrado);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(tok: string, ruta: string): Promise<Plano> {
  await sleep(PAUSA_MS);
  const r = await fetch(BASE + ruta, { headers: { Accept: 'application/json', Authorization: tok } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`Sperant HTTP ${r.status} en ${ruta}: ${texto.slice(0, 200)}`);
  try {
    return JSON.parse(texto) as Plano;
  } catch {
    throw new Error(`Sperant devolvió algo que no es JSON en ${ruta}`);
  }
}

/** {id, type, attributes} → {id, ...attributes}. */
function plano(row: unknown): Plano {
  if (row && typeof row === 'object' && 'attributes' in row) {
    const r = row as { id?: unknown; attributes?: Plano };
    return { id: r.id, ...(r.attributes ?? {}) };
  }
  return (row ?? {}) as Plano;
}

function datos(body: Plano): Plano[] {
  const d = body.data;
  return Array.isArray(d) ? d.map(plano) : [];
}

/** Todas las páginas de un listado (JSON:API con links.next; per_page se ignora, son 20). */
async function todas(tok: string, ruta: string, alAvanzar?: (n: number) => void): Promise<Plano[]> {
  const filas: Plano[] = [];
  const vistos = new Set<string>();
  const sep = ruta.includes('?') ? '&' : '?';
  for (let pagina = 1; pagina < 5000; pagina++) {
    const body = await get(tok, `${ruta}${sep}page=${pagina}`);
    const d = datos(body);
    let nuevos = 0;
    for (const f of d) {
      const k = String(f.id ?? JSON.stringify(f));
      if (vistos.has(k)) continue;
      vistos.add(k);
      filas.push(f);
      nuevos++;
    }
    alAvanzar?.(filas.length);
    const links = (body.links ?? {}) as { next?: string | null; last?: string | null };
    const esUltima = !links.next || links.next === links.last && pagina >= Number(new URL(links.last!).searchParams.get('page') ?? pagina);
    if (d.length === 0 || nuevos === 0 || esUltima) break;
  }
  return filas;
}

// ------------------------------------------------------------------ probar

export async function probar(organizationId: string) {
  const tok = await token(organizationId);
  const proyectos = datos(await get(tok, '/v3/projects'));
  const clientes = await get(tok, '/v3/clients?page=1');
  const meta = clientes.meta as { page?: { total?: number } } | undefined;
  return {
    ok: true,
    proyectos: proyectos.map((p) => ({ id: Number(p.id), code: String(p.code ?? ''), name: String(p.name ?? '') })),
    totalLeads: meta?.page?.total ?? datos(clientes).length,
  };
}

// ------------------------------------------------------------------ exportar

const enMarcha = new Set<string>();

/**
 * Arranca (o reanuda) la exportación en segundo plano. Devuelve enseguida.
 * Lanza si ya hay una viva.
 */
export async function iniciarExportacion(organizationId: string) {
  if (enMarcha.has(organizationId) || tareaEnCurso(organizationId)) {
    throw new Error('Ya hay una tarea en curso');
  }
  const tok = await token(organizationId); // falla aquí si no hay token
  const a = await leerAjustes(organizationId);
  enMarcha.add(organizationId);
  guardarEstado(organizationId, {
    ...leerEstado(organizationId),
    fase: 'exportando',
    tarea: 'exportar',
    inicio: new Date().toISOString(),
    latido: new Date().toISOString(),
    fin: undefined,
    error: null,
  });
  setImmediate(() => {
    exportar(organizationId, tok, a.sperant?.sperantProjectId ?? null)
      .then(() => {
        guardarEstado(organizationId, { ...leerEstado(organizationId), fase: 'exportado', fin: new Date().toISOString(), error: null });
        logLine(`[sperant] exportación terminada para ${organizationId}`);
      })
      .catch((err) => {
        logError('[sperant] exportación falló:', err);
        guardarEstado(organizationId, { ...leerEstado(organizationId), fase: 'error', fin: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => enMarcha.delete(organizationId));
  });
}

async function exportar(organizationId: string, tok: string, sperantProjectId: number | null) {
  const previo = leerDatos(organizationId);
  const d: DatosExport = previo ?? {
    version: 1,
    exportadoEl: new Date().toISOString(),
    catalogos: {},
    projects: [],
    types: [],
    units: [],
    users: [],
    clientes: [],
    detalle: {},
    proyectos: {},
    budgets: [],
  };
  const latir = (hechos: number, total: number) =>
    guardarEstado(organizationId, { ...leerEstado(organizationId), latido: new Date().toISOString(), hechos, total });

  // 1) Catálogos, proyectos, usuarios e inventario: baratos, se rehacen siempre.
  for (const [nombre, ruta] of [
    ['input_channels', '/v3/input_channels'],
    ['captation_ways', '/v3/captation_ways'],
    ['interest_types', '/v3/interest_types'],
    ['document_types', '/v3/document_types'],
  ] as const) {
    d.catalogos[nombre] = await todas(tok, ruta);
  }
  d.projects = await todas(tok, '/v3/projects');
  d.users = await todas(tok, '/v3/users');
  // Inventario de TODOS los proyectos de la cuenta. Qué se importa y adónde lo decide la
  // persona en el paso 3; aquí no se elige nada (elegir solo metió Bordeaux en Domus).
  // El listado de unidades trae pocas columnas; el detalle de cada una trae piso, áreas,
  // vista, dormitorios y baños. Barato (decenas de unidades), se rehace siempre.
  void sperantProjectId;
  d.inventarios = {};
  for (const pr of d.projects) {
    const pid = Number(pr.id);
    const units = await todas(tok, `/v3/projects/${pid}/units`);
    const unidadesDetalle: Record<string, Plano> = {};
    for (const u of units) unidadesDetalle[String(u.id)] = plano((await get(tok, `/v3/units/${u.id}`)).data);
    d.inventarios[String(pid)] = {
      id: pid,
      nombre: String(pr.name ?? pid),
      codigo: pr.code ? String(pr.code) : null,
      detalle: plano((await get(tok, `/v3/projects/${pid}`)).data),
      imagenes: await todas(tok, `/v3/projects/${pid}/images`),
      types: await todas(tok, `/v3/projects/${pid}/types`),
      units,
      unidadesDetalle,
    };
  }
  // Los campos de un solo proyecto quedan vacíos: todo vive en `inventarios`.
  d.types = []; d.units = []; d.unidadesDetalle = undefined; d.proyectoDetalle = undefined; d.proyectoImagenes = undefined;
  d.inventarioDe = undefined; d.tiposOtrosProyectos = undefined;
  guardarDatos(organizationId, d);

  // 2) Listado de clientes: siempre completo, para detectar los nuevos desde la última vez.
  d.clientes = await todas(tok, '/v3/clients', (n) => latir(0, n));
  guardarDatos(organizationId, d);

  // 3) Detalle + proyectos por cliente: lo caro. Se salta lo que ya está (reanudable).
  const total = d.clientes.length;
  let hechos = 0;
  let desdeGuardado = 0;
  for (const c of d.clientes) {
    const id = String(c.id);
    if (!d.detalle[id] || !d.proyectos[id]) {
      const det = await get(tok, `/v3/clients/${id}`);
      d.detalle[id] = plano(det.data);
      d.proyectos[id] = datos(await get(tok, `/v3/clients/${id}/projects`));
      desdeGuardado++;
    }
    hechos++;
    if (desdeGuardado >= CADA) {
      guardarDatos(organizationId, d);
      latir(hechos, total);
      desdeGuardado = 0;
    }
  }
  guardarDatos(organizationId, d);
  latir(hechos, total);

  // 4) Proformas con titulares y unidades.
  const budgets = await todas(tok, '/v3/budgets');
  const previos = new Map(d.budgets.map((b) => [String(b.id), b]));
  const completos: Plano[] = [];
  for (const b of budgets) {
    const ya = previos.get(String(b.id));
    if (ya && Array.isArray(ya.titulars)) { completos.push(ya); continue; }
    completos.push({
      ...b,
      titulars: datos(await get(tok, `/v3/budgets/${b.id}/titulars`)),
      units: datos(await get(tok, `/v3/budgets/${b.id}/units`)),
    });
  }
  d.budgets = completos;
  d.exportadoEl = new Date().toISOString();
  guardarDatos(organizationId, d);
}

// ------------------------------------------------------------------ resumen

function cuenta(valores: unknown[]): { valor: string; n: number }[] {
  const m = new Map<string, number>();
  for (const v of valores) {
    const k = v === null || v === undefined || v === '' ? '(vacío)' : String(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n);
}

function fecha(ts: unknown): Date | null {
  if (typeof ts === 'number' && ts > 0) return new Date(ts * 1000);
  if (typeof ts === 'string' && ts) { const d = new Date(ts); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}

/** Un lead unido: listado + detalle + relación con el proyecto (la primera). */
interface LeadSperant {
  id: number;
  fname: string;
  lname: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  documentType: string | null;
  wspUsername: string | null;
  createdAt: Date | null;
  lastInteractionAt: Date | null;
  sellerAssignedAt: Date | null;
  observation: string | null;
  reasonResign: string | null;
  emailConsent: boolean | null;
  publicityConsent: boolean | null;
  uuid: string | null;
  projectId: number | null;
  projectName: string | null;
  segment: string | null;
  seller: string | null;
  channel: string | null;
  sourceName: string | null;
  interest: string | null;
  /** Ficha completa tal como la devolvió Sperant: lo que el CRM no tiene como campo propio. */
  crudo: { cliente: Plano; proyectos: Plano[] };
}

/**
 * Sperant rellena el documento con `auto-123456` cuando el asesor no lo cargó. No es un
 * documento: guardarlo ensucia la ficha y la deduplicación por DNI.
 */
const docReal = (v: string | null) => (v && !/^auto-/i.test(v) ? v : null);

/**
 * Un registro por cliente Y proyecto: en el CRM un lead es una persona interesada en un
 * proyecto, así que el cliente de Sperant que consultó dos proyectos son dos leads con el
 * mismo contacto. El cliente sin ningún proyecto en el export (la petición falló) sale una
 * vez con `projectId` null y no se importa hasta exportar de nuevo.
 */
function unir(d: DatosExport): LeadSperant[] {
  const out: LeadSperant[] = [];
  for (const c of d.clientes) {
    const id = String(c.id);
    const det = d.detalle[id] ?? {};
    const rels: Plano[] = (d.proyectos[id] ?? []).length ? d.proyectos[id] : [{}];
    for (const rel of rels) {
    const s = (v: unknown) => (v === null || v === undefined ? null : String(v).trim() || null);
    out.push({
      id: Number(c.id),
      fname: s(det.fname ?? c.fname) ?? 'Sin nombre',
      lname: s(det.lname ?? c.lname) === '.' ? null : s(det.lname ?? c.lname),
      email: s(det.email ?? c.email),
      phone: s(det.phone ?? c.phone ?? det.main_telephone),
      document: s(det.document),
      documentType: s(det.document_type),
      wspUsername: s(det.wsp_username ?? c.wsp_username),
      createdAt: fecha(det.created_at),
      lastInteractionAt: fecha(rel.last_interaction_at ?? det.last_interaction_date ?? c.last_interaction_date),
      sellerAssignedAt: fecha(rel.seller_assigned_at),
      observation: s(det.observation),
      reasonResign: s(det.reason_resign_name),
      emailConsent: typeof det.email_consent === 'boolean' ? det.email_consent : null,
      publicityConsent: typeof det.publicity_consent === 'boolean' ? det.publicity_consent : null,
      uuid: s(det.uuid ?? c.uuid),
      projectId: rel.id !== undefined ? Number(rel.id) : null,
      projectName: s(rel.name),
      segment: s(rel.segment_name),
      seller: s(rel.seller_username),
      channel: s(rel.input_channel_name),
      sourceName: s(rel.source_name),
      interest: s(rel.interest_type_name ?? det.interest_type),
      crudo: { cliente: det, proyectos: d.proyectos[id] ?? [] },
    });
    }
  }
  return out;
}

/** Clave de idempotencia: cliente de Sperant + proyecto de Sperant. */
const claveLead = (clientId: number | string, projectId: number | string | null) => `${clientId}:${projectId ?? '*'}`;

export function resumen(organizationId: string) {
  const d = leerDatos(organizationId);
  if (!d) return null;
  const registros = unir(d);
  // Las cifras de leads van por cliente (el primer proyecto de cada uno) para no contar dos
  // veces a quien consultó dos proyectos; el detalle por proyecto va en `proyectos`.
  const vistos = new Set<number>();
  const leads = registros.filter((l) => (vistos.has(l.id) ? false : (vistos.add(l.id), true)));
  const invs = inventariosDe(d);
  const proyectos = d.projects.map((p) => {
    const pid = Number(p.id);
    const inv = invs.find((x) => x.id === pid);
    return {
      id: pid,
      nombre: String(p.name ?? pid),
      codigo: p.code ? String(p.code) : null,
      leads: registros.filter((l) => l.projectId === pid).length,
      unidades: inv?.units.length ?? null,
      tipologias: inv ? inv.types.map((t) => String(t.name ?? t.id)) : null,
      porEstado: inv ? cuenta(inv.units.map((u) => u.commercial_status)) : [],
      proformas: d.budgets.filter((b) => Number(b.project_id) === pid).length,
      direccion: inv?.detalle ? String(((inv.detalle.ubication ?? {}) as Plano).address ?? '') || null : null,
    };
  });
  const sinProyecto = registros.filter((l) => l.projectId === null).length;
  const porMes = cuenta(leads.map((l) => (l.createdAt ? l.createdAt.toISOString().slice(0, 7) : null))).sort((a, b) => a.valor.localeCompare(b.valor));
  const fechas = leads.map((l) => l.createdAt).filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime());
  return {
    exportadoEl: d.exportadoEl,
    leads: {
      total: leads.length,
      desde: fechas[0]?.toISOString() ?? null,
      hasta: fechas[fechas.length - 1]?.toISOString() ?? null,
      porMes,
      proyectos: cuenta(leads.map((l) => l.projectName)),
      etapas: cuenta(leads.map((l) => l.segment)),
      asesores: cuenta(leads.map((l) => l.seller)),
      canales: cuenta(leads.map((l) => l.channel)),
      medios: cuenta(leads.map((l) => l.sourceName)),
      interes: cuenta(leads.map((l) => l.interest)),
      motivos: cuenta(leads.map((l) => l.reasonResign)),
      sinTelefono: leads.filter((l) => !l.phone).length,
      sinCorreo: leads.filter((l) => !l.email).length,
      sinDocumento: leads.filter((l) => !l.document).length,
      conObservacion: leads.filter((l) => !!l.observation).length,
      sinNumeroWhatsApp: leads.filter((l) => !!l.wspUsername).length,
    },
    proyectos,
    sinProyecto,
    /** El export es de antes de traer todos los proyectos: exportar de nuevo. */
    exportViejo: !d.inventarios,
    proformas: {
      total: d.budgets.length,
      activas: d.budgets.filter((b) => b.active === true).length,
      financiamiento: cuenta(d.budgets.map((b) => b.funding_type)),
    },
    usuarios: d.users.map((u) => ({ username: String(u.username ?? ''), nombre: `${u.fname ?? ''} ${u.lname ?? ''}`.trim(), email: String(u.email ?? '') })),
  };
}

/**
 * Propuesta de mapa: etapas por nombre parecido, asesores por correo/usuario. La persona
 * lo corrige en pantalla; esto solo ahorra clics.
 */
export async function sugerirMapa(organizationId: string) {
  const r = resumen(organizationId);
  if (!r) return null;
  const [etapas, usuarios] = await Promise.all([
    prisma.stage.findMany({ where: { organizationId }, orderBy: { position: 'asc' } }),
    prisma.user.findMany({ where: { organizationId, active: true }, select: { id: true, email: true, name: true } }),
  ]);
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/s$/, '');
  const mapaEtapas: Record<string, string | null> = {};
  for (const e of r.leads.etapas) {
    const k = norm(e.valor);
    const igual = etapas.find((x) => norm(x.name) === k);
    mapaEtapas[e.valor] = igual ? igual.id : /desestim|perdid/.test(k) ? 'crear_perdida' : 'crear';
  }
  const mapaAsesores: Record<string, string | null> = {};
  for (const a of r.leads.asesores) {
    const su = r.usuarios.find((u) => u.username === a.valor);
    const porCorreo = su ? usuarios.find((u) => u.email.toLowerCase() === su.email.toLowerCase()) : undefined;
    const porNombre = usuarios.find((u) => norm(u.name).includes(norm(a.valor)) || norm(a.valor).includes(norm(u.name.split(' ')[0] ?? '')));
    mapaAsesores[a.valor] = porCorreo?.id ?? porNombre?.id ?? null;
  }
  // Proyecto de Sperant → del CRM con el mismo nombre; si no hay y tiene leads, crear; si no
  // tiene leads (Bordeaux en Bastión: solo inventario de otro cliente), no importar.
  const crm = await prisma.project.findMany({ where: { organizationId }, select: { id: true, name: true } });
  const mapaProyectos: Record<string, string | null> = {};
  for (const p of r.proyectos) {
    const igual = crm.find((c) => norm(c.name) === norm(p.nombre));
    mapaProyectos[String(p.id)] = igual ? igual.id : p.leads > 0 ? 'crear' : null;
  }
  return { proyectos: mapaProyectos, etapas: mapaEtapas, asesores: mapaAsesores, etapasCrm: etapas.map((e) => ({ id: e.id, name: e.name, isLost: e.isLost, isWon: e.isWon })), usuariosCrm: usuarios };
}

// ------------------------------------------------------------------ importar

const FUENTE: Record<string, string> = {
  meta: 'meta_ads',
  whatsapp: 'whatsapp',
  'contacto web': 'web_form',
};

const INTERES: Record<string, number | null> = { bajo: 1, intermedio: 2, alto: 3 };

/** Estados comerciales vistos en Bastión: disponible, no disponible, pre-asignado. */
function estadoUnidad(v: unknown): 'disponible' | 'reservado' | 'vendido' | 'no_disponible' {
  const t = String(v ?? '').toLowerCase();
  if (t === 'disponible') return 'disponible';
  if (/vendid|entregad/.test(t)) return 'vendido';
  if (/separad|reservad|asignad|bloquead/.test(t)) return 'reservado';
  return 'no_disponible';
}

/** Tipos vistos: «departamento flat», «departamento duplex», «estacionamiento», «depósito». */
function tipoUnidad(v: unknown): 'departamento' | 'estacionamiento' | 'deposito' | 'lote' | 'oficina' | 'otro' {
  const t = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/departamento|dpto|flat|duplex|penthouse|vivienda/.test(t)) return 'departamento';
  if (/estacionamiento|cochera|parking/.test(t)) return 'estacionamiento';
  if (/deposito|bodega/.test(t)) return 'deposito';
  if (/lote|terreno/.test(t)) return 'lote';
  if (/oficina|local/.test(t)) return 'oficina';
  return 'otro';
}

function soles(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toLocaleString('es-PE', { maximumFractionDigits: 0 }) : String(n ?? '');
}
const fechaCorta = (d: Date | null) => (d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/**
 * Importa (o simula). Con `simulacion` no escribe nada en la base.
 *
 * Idempotencia: los leads ya importados se reconocen por `attribution.sperant.client_id`.
 * Fusión: si el contacto ya tiene un lead activo en el mismo proyecto (por ejemplo uno que
 * entró por WhatsApp durante el demo), no se crea otro: se le anota la procedencia y se
 * completan dueño y etapa si estaban vacíos.
 */
export async function importar(organizationId: string, mapa: MapaImporte, simulacion: boolean): Promise<InformeImporte> {
  const d = leerDatos(organizationId);
  if (!d) throw new Error('No hay datos exportados');
  const informe: InformeImporte = {
    simulacion,
    leads: { total: 0, nuevos: 0, fusionados: 0, yaImportados: 0, omitidos: 0, sinEtapa: 0, sinAsesor: 0, deProyectoNoImportado: 0, sinProyecto: 0, errores: 0 },
    proyectos: [],
    contactos: { nuevos: 0, existentes: 0 },
    unidades: { creadas: 0, actualizadas: 0, sinCambios: 0, pendientes: 0, tipologiasCreadas: 0, diferencias: [] },
    proformas: { notas: 0 },
    etapasCreadas: [],
    erroresDetalle: [],
  };
  const latir = (hechos: number, total: number) => {
    if (!simulacion) guardarEstado(organizationId, { ...leerEstado(organizationId), latido: new Date().toISOString(), hechos, total });
  };

  // --- proyectos: Sperant → CRM. Cada proyecto del CRM recibe a lo sumo uno de Sperant:
  // juntar dos inventarios en un proyecto es justo lo que no puede volver a pasar.
  const destinos = Object.values(mapa.proyectos).filter((v): v is string => !!v && v !== 'crear');
  if (new Set(destinos).size !== destinos.length) throw new Error('Dos proyectos de Sperant apuntan al mismo proyecto del CRM');
  if (!Object.values(mapa.proyectos).some(Boolean)) throw new Error('Elige al menos un proyecto de Sperant para importar');
  const proyectoCrm = new Map<number, { id: string; name: string }>();
  for (const [pidTxt, destino] of Object.entries(mapa.proyectos)) {
    const pid = Number(pidTxt);
    const pr = d.projects.find((x) => Number(x.id) === pid);
    if (!pr) throw new Error(`El proyecto ${pidTxt} no está en el export`);
    const fila = { sperant: String(pr.name ?? pid), crm: null as string | null, creado: false, leads: 0, unidades: 0 };
    informe.proyectos.push(fila);
    if (!destino) continue;
    if (destino === 'crear') {
      const nombre = String(pr.name ?? `Proyecto ${pid}`);
      const ya = await prisma.project.findFirst({ where: { organizationId, name: nombre } });
      if (ya) throw new Error(`Ya existe un proyecto «${nombre}» en el CRM: elígelo en vez de crear otro`);
      fila.crm = nombre; fila.creado = true;
      if (simulacion) { proyectoCrm.set(pid, { id: `(nuevo) ${nombre}`, name: nombre }); continue; }
      const inv = inventariosDe(d).find((x) => x.id === pid);
      const base = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'proyecto';
      let slug = base;
      for (let i = 2; await prisma.project.findFirst({ where: { organizationId, slug } }); i++) slug = `${base}-${i}`;
      const nuevo = await prisma.project.create({
        data: { organizationId, name: nombre, slug, code: pr.code ? String(pr.code) : null, address: inv?.detalle ? String(((inv.detalle.ubication ?? {}) as Plano).address ?? '') || null : null },
      });
      proyectoCrm.set(pid, { id: nuevo.id, name: nuevo.name });
      continue;
    }
    const existe = await prisma.project.findFirst({ where: { id: destino, organizationId } });
    if (!existe) throw new Error(`El proyecto del CRM elegido para ${fila.sperant} no existe`);
    fila.crm = existe.name;
    proyectoCrm.set(pid, { id: existe.id, name: existe.name });
  }
  const filaDe = (pid: number) => informe.proyectos.find((f) => f.sperant === String(d.projects.find((x) => Number(x.id) === pid)?.name ?? pid));

  // --- etapas: resolver `crear` / `crear_perdida` (de verdad solo si no es simulación)
  const etapas = await prisma.stage.findMany({ where: { organizationId }, orderBy: { position: 'asc' } });
  const etapaPorSegmento = new Map<string, { id: string; isLost: boolean; isWon: boolean } | null>();
  let posicion = (etapas[etapas.length - 1]?.position ?? 0) + 1;
  for (const [segmento, destino] of Object.entries(mapa.etapas)) {
    if (destino === null) { etapaPorSegmento.set(segmento, null); continue; }
    if (destino === 'crear' || destino === 'crear_perdida') {
      const isLost = destino === 'crear_perdida';
      // Si una pasada anterior ya la creó, se reutiliza: correr la importación otra vez no
      // puede duplicar etapas.
      const yaCreada = etapas.find((e) => e.name.trim().toLowerCase() === segmento.trim().toLowerCase());
      if (yaCreada) { etapaPorSegmento.set(segmento, yaCreada); continue; }
      informe.etapasCreadas.push(segmento);
      if (simulacion) { etapaPorSegmento.set(segmento, { id: `(nueva) ${segmento}`, isLost, isWon: false }); continue; }
      const slugBase = segmento.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'etapa';
      let slug = slugBase;
      for (let i = 2; etapas.some((e) => e.slug === slug); i++) slug = `${slugBase}-${i}`;
      const nueva = await prisma.stage.create({ data: { organizationId, slug, name: segmento, position: posicion++, isLost } });
      etapas.push(nueva);
      etapaPorSegmento.set(segmento, nueva);
      continue;
    }
    const e = etapas.find((x) => x.id === destino);
    if (!e) throw new Error(`La etapa ${destino} no existe`);
    etapaPorSegmento.set(segmento, e);
  }

  const usuarios = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
  const usuarioOk = new Set(usuarios.map((u) => u.id));

  // --- inventario, proyecto por proyecto
  if (mapa.importarUnidades) for (const inv of inventariosDe(d)) {
    const project = proyectoCrm.get(inv.id);
    if (!project) continue;
    if (project.id.startsWith('(nuevo)')) {
      // Simulación de un proyecto que todavía no existe: todo sería nuevo.
      informe.unidades.creadas += inv.units.length;
      informe.unidades.tipologiasCreadas += inv.types.length;
      filaDe(inv.id)!.unidades = inv.units.length;
      continue;
    }
    filaDe(inv.id)!.unidades = inv.units.length;
    const tipologias = await prisma.typology.findMany({ where: { projectId: project.id } });
    const porNombre = new Map(tipologias.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    for (const t of inv.types) {
      const nombre = String(t.name ?? '').trim();
      if (!nombre) continue;
      const datosTip = {
        bedrooms: num(t.num_bedroom),
        bathrooms: num(t.num_bathroom),
        areaM2: num(t.area),
        priceFrom: num(t.price_min),
        imageUrl: typeof t.image === 'string' && t.image ? t.image : null,
        description: typeof t.description === 'string' && t.description.trim() ? t.description.trim() : null,
      };
      const idExistente = porNombre.get(nombre.toLowerCase());
      if (idExistente) {
        // Completa lo que falte sin pisar lo que el cliente ya editó en el CRM.
        if (!simulacion) {
          const actual = tipologias.find((x) => x.id === idExistente)!;
          await prisma.typology.update({
            where: { id: idExistente },
            data: {
              bedrooms: actual.bedrooms ?? datosTip.bedrooms,
              bathrooms: actual.bathrooms ?? datosTip.bathrooms,
              areaM2: actual.areaM2 ?? datosTip.areaM2,
              priceFrom: actual.priceFrom ?? datosTip.priceFrom,
              imageUrl: actual.imageUrl ?? datosTip.imageUrl,
              description: actual.description ?? datosTip.description,
            },
          });
        }
        continue;
      }
      informe.unidades.tipologiasCreadas++;
      if (!simulacion) {
        const nueva = await prisma.typology.create({ data: { projectId: project.id, name: nombre, code: nombre, ...datosTip } });
        porNombre.set(nombre.toLowerCase(), nueva.id);
      } else {
        porNombre.set(nombre.toLowerCase(), `(nueva) ${nombre}`);
      }
    }
    const existentes = await prisma.unit.findMany({ where: { projectId: project.id } });
    const porCodigo = new Map(existentes.map((u) => [u.code, u]));
    const aprobadas = new Set(mapa.unidadesAprobadas ?? []);
    const ETIQUETA: Record<string, string> = { price: 'precio', currency: 'moneda', status: 'estado', kind: 'tipo', areaM2: 'área m²', typology: 'tipología' };
    for (const u of inv.units) {
      const code = String(u.name ?? u.code ?? '').trim();
      if (!code) continue;
      const tipNombre = u.type ? String(u.type).trim() : null;
      const typologyId = tipNombre ? porNombre.get(tipNombre.toLowerCase()) ?? null : null;
      const datosUnidad = {
        typology: tipNombre,
        typologyId: typologyId && !typologyId.startsWith('(nueva)') ? typologyId : null,
        kind: tipoUnidad(u.property_type),
        status: estadoUnidad(u.commercial_status),
        areaM2: u.total_area != null ? Number(u.total_area) : null,
        price: u.price != null ? Number(u.price) : null,
        currency: String(u.currency ?? 'PEN'),
        extra: { sperant_unit_id: u.id, sperant_code: u.code } as Record<string, unknown>,
      };
      const existente = porCodigo.get(code);
      if (existente) {
        // Comparar campo a campo. Solo lo que difiere se muestra y solo lo aprobado se escribe.
        const cambios: DiferenciaUnidad['cambios'] = {};
        const comparar = (campo: keyof typeof ETIQUETA, crm: unknown, sp: unknown) => {
          const a = crm === null || crm === undefined ? null : typeof crm === 'object' ? Number(crm) : (crm as string | number);
          const b = sp === null || sp === undefined ? null : (sp as string | number);
          if (String(a ?? '') !== String(b ?? '')) cambios[ETIQUETA[campo]] = { crm: a, sperant: b };
        };
        comparar('price', existente.price, datosUnidad.price);
        comparar('currency', existente.currency, datosUnidad.currency);
        comparar('status', existente.status, datosUnidad.status);
        comparar('kind', existente.kind, datosUnidad.kind);
        comparar('areaM2', existente.areaM2, datosUnidad.areaM2);
        comparar('typology', existente.typology, datosUnidad.typology);
        if (Object.keys(cambios).length === 0) { informe.unidades.sinCambios++; continue; }
        const clave = `${inv.id}:${code}`;
        const aprobada = aprobadas.has(clave);
        informe.unidades.diferencias.push({ clave, proyecto: inv.nombre, code, cambios, aprobada });
        if (!aprobada) { informe.unidades.pendientes++; continue; }
        informe.unidades.actualizadas++;
        if (!simulacion) {
          // `extra` se combina: puede traer el detalle de Sperant que puso «Completar datos».
          await prisma.unit.update({ where: { id: existente.id }, data: { ...datosUnidad, extra: { ...((existente.extra ?? {}) as Record<string, unknown>), ...datosUnidad.extra } as never } });
          if (cambios.precio) {
            await prisma.auditLog.create({
              data: {
                organizationId,
                userId: mapa.userId ?? null,
                action: 'unit.price',
                entity: 'unit',
                entityId: existente.id,
                meta: { code, projectId: project.id, de: cambios.precio.crm, a: cambios.precio.sperant, origen: 'sperant' } as never,
              },
            });
          }
        }
      } else {
        informe.unidades.creadas++;
        if (!simulacion) await prisma.unit.create({ data: { ...datosUnidad, extra: datosUnidad.extra as never, code, projectId: project.id } });
      }
    }
  }

  // --- proformas por cliente (titular.id = client id)
  const proformasPorCliente = new Map<string, Plano[]>();
  if (mapa.importarProformas) {
    for (const b of d.budgets) {
      for (const t of (b.titulars as Plano[] | undefined) ?? []) {
        const k = claveLead(Number(t.id), b.project_id != null ? Number(b.project_id) : null);
        if (!proformasPorCliente.has(k)) proformasPorCliente.set(k, []);
        proformasPorCliente.get(k)!.push(b);
      }
    }
  }

  // --- leads ya importados (idempotencia)
  // Clave cliente:proyecto. Los leads importados antes de los multiproyecto no guardaban el
  // id del proyecto: se deduce por su nombre y, si tampoco está, cuentan para cualquiera.
  const previos = await prisma.lead.findMany({
    where: { organizationId, attribution: { path: '$.sperant', not: Prisma.AnyNull } },
    select: { id: true, attribution: true },
  });
  const pidPorNombre = new Map(d.projects.map((x) => [String(x.name ?? '').toLowerCase(), Number(x.id)]));
  const yaImportado = new Set<string>();
  for (const p of previos) {
    const a = p.attribution as { sperant?: { client_id?: number; project_id?: number; proyecto?: string }; sperant_fusiones?: number[] } | null;
    const pid = a?.sperant?.project_id ?? (a?.sperant?.proyecto ? pidPorNombre.get(a.sperant.proyecto.toLowerCase()) : undefined) ?? null;
    if (a?.sperant?.client_id) yaImportado.add(claveLead(a.sperant.client_id, pid));
    for (const id of a?.sperant_fusiones ?? []) yaImportado.add(claveLead(id, pid));
  }

  const leads = unir(d).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  informe.leads.total = leads.length;
  let n = 0;
  for (const l of leads) {
    n++;
    if (n % CADA === 0) latir(n, leads.length);
    try {
      if (l.projectId === null) { informe.leads.sinProyecto++; continue; }
      const project = proyectoCrm.get(l.projectId);
      if (!project) { informe.leads.deProyectoNoImportado++; continue; }
      if (yaImportado.has(claveLead(l.id, l.projectId)) || yaImportado.has(claveLead(l.id, null))) { informe.leads.yaImportados++; continue; }
      const segmento = l.segment ?? '(vacío)';
      if (!(segmento in mapa.etapas)) { informe.leads.sinEtapa++; }
      const etapa = etapaPorSegmento.get(segmento) ?? null;
      if (segmento in mapa.etapas && etapa === null) { informe.leads.omitidos++; continue; }

      const ownerId = l.seller ? mapa.asesores[l.seller] ?? null : null;
      if (!ownerId || !usuarioOk.has(ownerId)) informe.leads.sinAsesor++;
      const owner = ownerId && usuarioOk.has(ownerId) ? ownerId : null;

      const datosContacto = {
        fname: l.fname,
        lname: l.lname ?? undefined,
        email: normalizeEmail(l.email),
        phone: normalizePhonePE(l.phone),
        document: normalizeDocument(docReal(l.document)),
      };
      const existente = await prisma.contact.findFirst({
        where: {
          organizationId,
          OR: [
            ...(datosContacto.document ? [{ document: datosContacto.document }] : []),
            ...(datosContacto.email ? [{ email: datosContacto.email }] : []),
            ...(datosContacto.phone ? [{ phone: datosContacto.phone }] : []),
          ],
        },
        select: { id: true },
      });
      if (existente) informe.contactos.existentes++; else informe.contactos.nuevos++;

      const status = etapa?.isLost ? 'perdido' : etapa?.isWon ? 'ganado' : 'activo';
      const attribution = {
        sperant: {
          client_id: l.id,
          project_id: l.projectId,
          uuid: l.uuid,
          canal: l.channel,
          medio: l.sourceName,
          interes: l.interest,
          etapa: l.segment,
          asesor: l.seller,
          wsp_username: l.wspUsername,
          proyecto: l.projectName,
          ultima_interaccion: l.lastInteractionAt?.toISOString() ?? null,
          asignado_el: l.sellerAssignedAt?.toISOString() ?? null,
          importado_el: new Date().toISOString(),
          ...l.crudo,
        },
      };
      const creado = l.createdAt ?? new Date();
      const proformas = proformasPorCliente.get(claveLead(l.id, l.projectId)) ?? [];

      // ¿Ya hay un lead activo de este contacto en el proyecto? → fusionar.
      const leadActivo = existente && !project.id.startsWith('(nuevo)')
        ? await prisma.lead.findFirst({ where: { organizationId, contactId: existente.id, projectId: project.id, status: 'activo' }, select: { id: true, ownerId: true, stageId: true } })
        : null;

      if (leadActivo) {
        informe.leads.fusionados++;
        informe.proformas.notas += proformas.length;
        if (!simulacion) {
          // Si el lead ya venía de Sperant (dos registros de la misma persona en Sperant, mismo
          // DNI), se conserva la marca del primero y el segundo se anota en `sperant_fusiones`:
          // así los dos ids cuentan como importados en la siguiente pasada.
          const actual = ((await prisma.lead.findUnique({ where: { id: leadActivo.id }, select: { attribution: true } }))?.attribution ?? {}) as { sperant?: unknown; sperant_fusiones?: number[] } & Record<string, unknown>;
          const nuevaAttr = actual.sperant
            ? {
                ...actual,
                sperant_fusiones: [...(actual.sperant_fusiones ?? []), l.id],
                sperant_fusiones_datos: { ...((actual.sperant_fusiones_datos as Record<string, unknown>) ?? {}), [l.id]: l.crudo },
              }
            : { ...actual, ...attribution };
          await prisma.lead.update({
            where: { id: leadActivo.id },
            data: {
              ownerId: leadActivo.ownerId ?? owner,
              interestLevel: l.interest ? INTERES[l.interest] ?? undefined : undefined,
              attribution: nuevaAttr as never,
            },
          });
          await prisma.activity.create({ data: { leadId: leadActivo.id, type: 'sistema', body: `Fusionado con el lead de Sperant #${l.id} (${l.segment ?? 'sin etapa'}, ${l.seller ?? 'sin asesor'}, alta ${fechaCorta(creado)})`, createdAt: new Date() } });
          await notasProformas(leadActivo.id, proformas);
        }
        continue;
      }

      informe.leads.nuevos++;
      filaDe(l.projectId)!.leads++;
      informe.proformas.notas += proformas.length;
      if (simulacion) continue;

      const contacto = existente ? { id: existente.id } : await upsertContacto(organizationId, datosContacto);
      if (!existente) {
        await prisma.contact.update({ where: { id: contacto.id }, data: { createdAt: creado, documentType: l.documentType ?? 'DNI' } });
      }
      const lead = await prisma.lead.create({
        data: {
          organizationId,
          contactId: contacto.id,
          projectId: project.id,
          stageId: etapa && !etapa.id.startsWith('(nueva)') ? etapa.id : null,
          ownerId: owner,
          status,
          source: FUENTE[(l.channel ?? '').toLowerCase()] ?? 'import',
          message: l.observation,
          interestLevel: l.interest ? INTERES[l.interest] ?? null : null,
          lostReason: etapa?.isLost ? l.reasonResign ?? 'Desestimado en Sperant' : null,
          attribution: attribution as never,
          consent: { origen: 'sperant', email: l.emailConsent, publicidad: l.publicityConsent } as never,
          firstContactAt: l.segment && l.segment.toLowerCase() !== 'nuevo' ? l.lastInteractionAt ?? creado : null,
          lastActivityAt: l.lastInteractionAt ?? creado,
          createdAt: creado,
        },
      });
      // El source nativo (meta_ads, whatsapp) sirve para los reportes; la marca de importación
      // y la idempotencia van en attribution.sperant.client_id.
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'sistema',
          body: `Importado de Sperant #${l.id}: ${l.segment ?? 'sin etapa'} · ${l.channel ?? '?'} / ${l.sourceName ?? '?'} · asesor ${l.seller ?? 'sin asignar'}${l.reasonResign ? ` · motivo: ${l.reasonResign}` : ''}`,
          meta: { sperant_client_id: l.id } as never,
          createdAt: creado,
        },
      });
      await notasProformas(lead.id, proformas);
    } catch (err) {
      informe.leads.errores++;
      if (informe.erroresDetalle.length < 50) informe.erroresDetalle.push({ clientId: l.id, motivo: err instanceof Error ? err.message.split('\n')[0] : String(err) });
    }
  }
  informe.fin = new Date().toISOString();
  if (!simulacion) {
    // «Completar datos» sabe así adónde fue cada inventario sin deducirlo.
    const previo = leerEstado(organizationId).mapaProyectos ?? {};
    guardarEstado(organizationId, { ...leerEstado(organizationId), mapaProyectos: { ...previo, ...Object.fromEntries([...proyectoCrm].map(([k, v]) => [String(k), v.id])) } });
  }
  return informe;
}

/** Texto de la nota de una proforma de Sperant, con precios por unidad y cotitulares. */
function textoProforma(b: Plano) {
  const mon = b.currency === 'USD' ? 'US$' : 'S/';
  const unidades = ((b.units as Plano[] | undefined) ?? [])
    .map((u) => `${u.name ?? u.code}${u.sale_price != null ? ` ${mon} ${soles(u.sale_price)}` : ''}${u.discount ? ` (dto ${soles(u.discount)})` : ''}`)
    .join(', ');
  const total = soles(b.total_price);
  const conDto = b.total_price_discount != null && Number(b.total_price_discount) !== Number(b.total_price) ? ` → con descuento ${mon} ${soles(b.total_price_discount)}` : '';
  const titulares = ((b.titulars as Plano[] | undefined) ?? []);
  const cotitulares = titulares.length > 1
    ? ` · titulares: ${titulares.map((t) => `${[t.fname, t.lname].filter(Boolean).join(' ')}${t.document ? ` (doc ${t.document})` : ''}${t.percentage != null ? ` ${t.percentage}%` : ''}`).join('; ')}`
    : '';
  const tope = b.can_discount ? ` · descuento autorizado hasta ${mon} ${soles(b.can_discount)}` : '';
  return `Proforma en Sperant ${b.code ?? b.id} del ${fechaCorta(fecha(b.created_at))}: ${unidades || 'sin unidades'} · total ${mon} ${total}${conDto} · ${b.funding_type ?? ''}${b.expire_date ? ` · vence ${fechaCorta(fecha(b.expire_date))}` : ''}${tope}${cotitulares}`;
}

async function notasProformas(leadId: string, proformas: Plano[]) {
  for (const b of proformas) {
    await prisma.activity.create({
      data: {
        leadId,
        type: 'nota',
        body: textoProforma(b),
        meta: { sperant_budget_id: b.id, sperant_budget_code: b.code, sperant_budget: b } as never,
        createdAt: fecha(b.created_at) ?? new Date(),
      },
    });
  }
}

export interface InformeCompletar {
  simulacion: boolean;
  leadsRevisados: number;
  leadsCompletados: number;
  fusionesCompletadas: number;
  documentosFalsosLimpiados: number;
  proformasCompletadas: number;
  sinLeadEnCrm: number;
  /** Diagnóstico: lo que explica números raros. */
  diagnostico: {
    clientesEnExport: number;
    /** Clientes sin ficha de detalle en el export (la exportación se cortó para ellos). */
    sinDetalleEnExport: number;
    documentosAutoEnExport: number;
    /** El contacto del CRM no tiene documento: ya se quitó, o el contacto existía antes de importar. */
    documentoAutoContactoSinDocumento: number;
    /** El contacto del CRM tiene otro documento (existía antes con DNI real, o se editó). */
    documentoAutoContactoConOtro: number;
    proformasEnExport: number;
    notasProformaExistentes: number;
    /** Proformas del export que no tenían nota en el lead (importación sin proformas). */
    notasProformaACrear: number;
  };
  /** El export no dice de qué proyecto es el inventario (export viejo): exportar de nuevo. */
  inventarioDesconocido: boolean;
  inventarios: InfoInventario[];
  /** Leads importados sin etapa ni asesor (la exportación no trajo su proyecto) y que ahora se reparan. */
  reparados: { leads: number; conEtapa: number; perdidos: number; sinEtapaEnCrm: string[] };
}

export interface InfoInventario {
    /** La exportación es anterior al detalle de unidades: hay que exportar de nuevo. */
    faltaExportarDetalle: boolean;
    proyecto: string | null;
    unidadesCompletadas: number;
    unidadesSinParejaEnCrm: string[];
    tipologiasCompletadas: number;
    imagenesCopiadas: number;
    imagenesConError: number;
    direccionCompletada: boolean;
    /** Proyecto de Sperant del que viene el inventario del export. */
    inventarioDe: string | null;
    /** Unidades que vinieron de otro proyecto de Sperant y no existen en este: se quitan. */
    unidadesDeOtroProyecto: string[];
    /** Tipologías sin unidades que no están en este proyecto de Sperant: se quitan. */
    tipologiasDeOtroProyecto: string[];
    /** Tipologías ajenas que no se pueden quitar todavía (tienen unidades o interesados). */
    tipologiasAjenasEnUso: string[];
}

/**
 * Completa los leads YA importados con la ficha completa de Sperant.
 *
 * La primera versión del importador guardaba solo lo que el CRM tiene como campo (nombre,
 * teléfono, etapa…) y se perdía el resto: género, estado civil, ubicación, pareja, teléfono
 * principal, campos extra, interacciones manuales y digitales, cotitulares de las proformas.
 * Esto lo agrega dentro de `attribution.sperant` sin tocar nada de lo que el equipo ya editó
 * en el CRM (etapa, asesor, datos de contacto). Además quita los documentos `auto-…` que
 * Sperant pone cuando no hay DNI, solo si el contacto sigue teniendo exactamente ese valor.
 *
 * Idempotente: correrlo dos veces no cambia nada la segunda.
 */
export async function completarDatos(organizationId: string, simulacion: boolean): Promise<InformeCompletar> {
  const d = leerDatos(organizationId);
  if (!d) throw new Error('No hay datos exportados');
  const informe: InformeCompletar = {
    simulacion, leadsRevisados: 0, leadsCompletados: 0, fusionesCompletadas: 0, documentosFalsosLimpiados: 0, proformasCompletadas: 0, sinLeadEnCrm: 0,
    inventarioDesconocido: false,
    inventarios: [],
    reparados: { leads: 0, conEtapa: 0, perdidos: 0, sinEtapaEnCrm: [] },
    diagnostico: { clientesEnExport: 0, sinDetalleEnExport: 0, documentosAutoEnExport: 0, documentoAutoContactoSinDocumento: 0, documentoAutoContactoConOtro: 0, proformasEnExport: d.budgets.length, notasProformaExistentes: 0, notasProformaACrear: 0 },
  };
  const registros = unir(d);
  const porCliente = new Map<number, LeadSperant[]>();
  for (const r of registros) porCliente.set(r.id, [...(porCliente.get(r.id) ?? []), r]);
  const todos = [...porCliente.values()].map((x) => x[0]);
  const pidPorNombre = new Map(d.projects.map((x) => [String(x.name ?? '').toLowerCase(), Number(x.id)]));
  /** El registro de Sperant que corresponde a un lead: por id de proyecto, por nombre, o el único. */
  const elegir = (cid: number, sp: { project_id?: number; proyecto?: string } | undefined) => {
    const opciones = porCliente.get(cid) ?? [];
    const pid = sp?.project_id ?? (sp?.proyecto ? pidPorNombre.get(sp.proyecto.toLowerCase()) : undefined);
    return (pid != null ? opciones.find((o) => o.projectId === pid) : undefined) ?? opciones.find((o) => o.projectId !== null) ?? opciones[0];
  };
  informe.diagnostico.clientesEnExport = todos.length;
  informe.diagnostico.sinDetalleEnExport = todos.filter((l) => Object.keys(l.crudo.cliente).length === 0).length;
  informe.diagnostico.documentosAutoEnExport = todos.filter((l) => l.document && !docReal(l.document)).length;
  const leadPorCliente = new Map<string, string>();
  const anotar = (k: string, leadId: string) => { if (!leadPorCliente.has(k)) leadPorCliente.set(k, leadId); };

  const leads = await prisma.lead.findMany({
    where: { organizationId, attribution: { path: '$.sperant', not: Prisma.AnyNull } },
    select: {
      id: true, attribution: true, stageId: true, interestLevel: true, source: true, firstContactAt: true, lostReason: true, createdAt: true, projectId: true,
      contact: { select: { id: true, document: true } },
    },
  });
  const etapas = await prisma.stage.findMany({ where: { organizationId } });
  const sinTildes = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  const etapaPorNombre = (seg: string) => etapas.find((e) => sinTildes(e.name) === sinTildes(seg)) ?? null;
  const vistos = new Set<number>();
  for (const lead of leads) {
    informe.leadsRevisados++;
    const attr = (lead.attribution ?? {}) as Record<string, unknown> & {
      sperant?: Record<string, unknown> & { client_id?: number };
      sperant_fusiones?: number[];
      sperant_fusiones_datos?: Record<string, unknown>;
    };
    const cid = Number(attr.sperant?.client_id);
    const l = elegir(cid, attr.sperant as { project_id?: number; proyecto?: string });
    if (!l) continue;
    vistos.add(cid);
    anotar(claveLead(cid, l.projectId), lead.id);
    anotar(claveLead(cid, null), lead.id);
    for (const f of attr.sperant_fusiones ?? []) { anotar(claveLead(f, l.projectId), lead.id); anotar(claveLead(f, null), lead.id); }
    let nueva = attr;
    if (!attr.sperant?.cliente) {
      nueva = { ...nueva, sperant: { ...attr.sperant, ...l.crudo } };
      informe.leadsCompletados++;
    }

    /**
     * Reparación: en la primera exportación de Bastión, 571 clientes llegaron sin su parte de
     * proyecto (etapa, asesor, canal) y entraron sin etapa, abiertos y con fuente «import».
     * Si el export ya la trae, se completa la marca de Sperant y, solo donde sigue vacío,
     * etapa (por nombre), estado, motivo, interés, fuente y primer contacto.
     */
    const datosLead: Record<string, unknown> = {};
    if (!attr.sperant?.etapa && !attr.sperant?.asesor && (l.segment || l.seller)) {
      informe.reparados.leads++;
      nueva = {
        ...nueva,
        sperant: {
          ...(nueva.sperant ?? {}),
          project_id: l.projectId, canal: l.channel, medio: l.sourceName, interes: l.interest, etapa: l.segment, asesor: l.seller, proyecto: l.projectName,
          ultima_interaccion: l.lastInteractionAt?.toISOString() ?? null, asignado_el: l.sellerAssignedAt?.toISOString() ?? null,
          proyectos: l.crudo.proyectos,
        },
      };
      if (!lead.stageId && l.segment) {
        const e = etapaPorNombre(l.segment);
        if (e) {
          informe.reparados.conEtapa++;
          datosLead.stageId = e.id;
          datosLead.status = e.isLost ? 'perdido' : e.isWon ? 'ganado' : 'activo';
          if (e.isLost) { informe.reparados.perdidos++; if (!lead.lostReason) datosLead.lostReason = l.reasonResign ?? 'Desestimado en Sperant'; }
        } else if (!informe.reparados.sinEtapaEnCrm.includes(l.segment)) informe.reparados.sinEtapaEnCrm.push(l.segment);
      }
      if (lead.interestLevel == null && l.interest && INTERES[l.interest] != null) datosLead.interestLevel = INTERES[l.interest];
      if (lead.source === 'import' && FUENTE[(l.channel ?? '').toLowerCase()]) datosLead.source = FUENTE[(l.channel ?? '').toLowerCase()];
      if (!lead.firstContactAt && l.segment && l.segment.toLowerCase() !== 'nuevo') datosLead.firstContactAt = l.lastInteractionAt ?? lead.createdAt;
    } else if (attr.sperant?.cliente && !(attr.sperant as { proyectos?: unknown[] }).proyectos?.length && l.crudo.proyectos.length) {
      nueva = { ...nueva, sperant: { ...(nueva.sperant ?? {}), proyectos: l.crudo.proyectos } };
    }
    if (!simulacion && Object.keys(datosLead).length) {
      await prisma.lead.update({ where: { id: lead.id }, data: datosLead });
      await prisma.activity.create({
        data: {
          leadId: lead.id,
          type: 'sistema',
          body: `Datos de Sperant reparados: etapa ${l.segment ?? '—'} · asesor ${l.seller ?? '—'} · ${l.channel ?? '?'} / ${l.sourceName ?? '?'}${l.reasonResign ? ` · motivo: ${l.reasonResign}` : ''}`,
        },
      });
    }
    const faltan = (attr.sperant_fusiones ?? []).filter((f) => porCliente.has(Number(f)) && !attr.sperant_fusiones_datos?.[f]);
    if (faltan.length) {
      nueva = {
        ...nueva,
        sperant_fusiones_datos: { ...(attr.sperant_fusiones_datos ?? {}), ...Object.fromEntries(faltan.map((f) => [f, porCliente.get(Number(f))![0].crudo])) },
      };
      informe.fusionesCompletadas += faltan.length;
    }
    for (const f of attr.sperant_fusiones ?? []) vistos.add(Number(f));
    if (!simulacion && nueva !== attr) {
      await prisma.lead.update({ where: { id: lead.id }, data: { attribution: nueva as never } });
    }
    const falso = l.document && !docReal(l.document) ? normalizeDocument(l.document) : null;
    if (falso && lead.contact.document === falso) {
      informe.documentosFalsosLimpiados++;
      if (!simulacion) await prisma.contact.update({ where: { id: lead.contact.id }, data: { document: null } });
    } else if (falso) {
      if (lead.contact.document) informe.diagnostico.documentoAutoContactoConOtro++;
      else informe.diagnostico.documentoAutoContactoSinDocumento++;
    }
  }
  informe.sinLeadEnCrm = [...porCliente.keys()].filter((k) => !vistos.has(k)).length;

  // Proformas: las notas ya creadas reciben la proforma completa y los cotitulares.
  const presupuestos = new Map(d.budgets.map((b) => [String(b.id), b]));
  const notas = await prisma.activity.findMany({
    where: { lead: { organizationId }, type: 'nota', meta: { path: '$.sperant_budget_id', not: Prisma.AnyNull } },
    select: { id: true, leadId: true, meta: true },
  });
  informe.diagnostico.notasProformaExistentes = notas.length;
  const conNota = new Set(notas.map((n) => `${n.leadId}:${String((n.meta as Record<string, unknown>)?.sperant_budget_id)}`));
  // Proformas sin nota (la importación se corrió sin proformas): se crean ahora, en el lead
  // de cada titular, con la fecha original.
  for (const b of d.budgets) {
    for (const t of (b.titulars as Plano[] | undefined) ?? []) {
      const leadId = leadPorCliente.get(claveLead(Number(t.id), b.project_id != null ? Number(b.project_id) : null)) ?? leadPorCliente.get(claveLead(Number(t.id), null));
      if (!leadId || conNota.has(`${leadId}:${String(b.id)}`)) continue;
      conNota.add(`${leadId}:${String(b.id)}`);
      informe.diagnostico.notasProformaACrear++;
      if (!simulacion) await notasProformas(leadId, [b]);
    }
  }
  for (const n of notas) {
    const meta = (n.meta ?? {}) as Record<string, unknown>;
    if (meta.sperant_budget) continue;
    const b = presupuestos.get(String(meta.sperant_budget_id));
    if (!b) continue;
    informe.proformasCompletadas++;
    if (!simulacion) {
      await prisma.activity.update({ where: { id: n.id }, data: { body: textoProforma(b), meta: { ...meta, sperant_budget: b } as never } });
    }
  }

  // Inventario, proyecto por proyecto. ¿Adónde fue cada uno? Lo que guardó la última
  // importación; si es de antes, el proyecto del CRM de los leads importados de ese proyecto
  // de Sperant. Nunca por las unidades: eso confundiría Bordeaux con Domus.
  const invs = inventariosDe(d);
  if (!invs.length && d.projects.length > 1) informe.inventarioDesconocido = true;
  const mapaGuardado = leerEstado(organizationId).mapaProyectos ?? {};
  const usados = new Set<string>();
  for (const inv of invs) {
    let projectId: string | null = mapaGuardado[String(inv.id)] ?? null;
    // El proyecto pudo borrarse del CRM después de importar.
    if (projectId && !(await prisma.project.findFirst({ where: { id: projectId, organizationId }, select: { id: true } }))) projectId = null;
    if (!projectId) {
      const cuenta = new Map<string, number>();
      for (const lead of leads) {
        const sp = (lead.attribution as { sperant?: { client_id?: number; project_id?: number; proyecto?: string } }).sperant;
        const l = sp?.client_id ? elegir(Number(sp.client_id), sp) : undefined;
        const pid = sp?.project_id ?? l?.projectId ?? null;
        const crm = lead.projectId;
        if (pid === inv.id && crm) cuenta.set(crm, (cuenta.get(crm) ?? 0) + 1);
      }
      projectId = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    }
    if (!projectId || usados.has(projectId)) continue;
    usados.add(projectId);
    const info: InfoInventario = { faltaExportarDetalle: false, proyecto: null, unidadesCompletadas: 0, unidadesSinParejaEnCrm: [], tipologiasCompletadas: 0, imagenesCopiadas: 0, imagenesConError: 0, direccionCompletada: false, inventarioDe: inv.nombre, unidadesDeOtroProyecto: [], tipologiasDeOtroProyecto: [], tipologiasAjenasEnUso: [] };
    informe.inventarios.push(info);
    const otros = [...invs.filter((x) => x.id !== inv.id).flatMap((x) => x.types.map((t) => String(t.name ?? '').trim())), ...(d.tiposOtrosProyectos ?? [])];
    await completarInventario(organizationId, projectId, inv, otros, simulacion, info);
  }
  return informe;
}

/** ¿Es un archivo de Sperant? Cuando Bastión deje Sperant, esas URLs pueden dejar de existir. */
const deSperant = (url: string | null | undefined) => !!url && /sperant\.s3\.amazonaws\.com|sperant\.com\//i.test(url);

/** Descarga una imagen de Sperant y la guarda en `uploads/` del CRM. Devuelve la ruta relativa. */
async function copiarImagen(organizationId: string, url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') ?? '').split(';')[0].trim();
    const g = await guardarMedia(organizationId, Buffer.from(await r.arrayBuffer()), mime);
    return 'ruta' in g ? g.ruta : null;
  } catch {
    return null;
  }
}

/**
 * Completa unidades, tipologías y proyecto con lo que el listado no traía.
 *
 * Solo rellena lo vacío en columnas propias (piso, dormitorios, baños, dirección) y agrega
 * el resto en `unit.extra.sperant` (vista, área techada y libre, estado de obra, unidad a la
 * que pertenece, fechas de separación/venta/entrega). No toca precio ni estado: eso pasa por
 * la comparativa con aprobación de la importación. Copia al CRM las imágenes que estaban en
 * los servidores de Sperant.
 */
async function completarInventario(organizationId: string, projectId: string, inv: InventarioSp, tiposOtros: string[], simulacion: boolean, inf: InfoInventario) {
  const proyecto = await prisma.project.findUnique({ where: { id: projectId } });
  if (!proyecto) return;
  inf.proyecto = proyecto.name;
  if (inv.units.length && !Object.keys(inv.unidadesDetalle).length) { inf.faltaExportarDetalle = true; return; }
  const d = { units: inv.units, types: inv.types, unidadesDetalle: inv.unidadesDetalle, proyectoDetalle: inv.detalle, tiposOtrosProyectos: tiposOtros };

  const unidades = await prisma.unit.findMany({ where: { projectId } });
  const porCodigo = new Map(unidades.map((u) => [u.code, u]));
  const codigoPorIdSp = new Map(d.units.map((u) => [String(u.id), String(u.name ?? u.code ?? '').trim()]));
  const entero = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
  const fechaIso = (v: unknown) => fecha(v)?.toISOString() ?? null;
  for (const u of d.units) {
    const code = String(u.name ?? u.code ?? '').trim();
    const det = d.unidadesDetalle[String(u.id)] ?? {};
    const crm = porCodigo.get(code);
    if (!crm) { inf.unidadesSinParejaEnCrm.push(code); continue; }
    const extraActual = (crm.extra ?? {}) as Record<string, unknown>;
    const previo = extraActual.sperant as { detalle?: unknown; unit_id?: unknown } | undefined;
    // Si el detalle guardado es de OTRA unidad de Sperant (el inventario de Bordeaux que se
    // coló en Domus), se rehace y se pisan piso/dormitorios/baños, que también eran ajenos.
    const ajeno = previo?.unit_id != null && String(previo.unit_id) !== String(u.id);
    if (previo?.detalle && !ajeno) continue;
    const ex = (det.extra_fields ?? {}) as Plano;
    const obra = (det.construction ?? {}) as Plano;
    const sperant = {
      unit_id: u.id,
      code: u.code,
      vista: ex.vista || null,
      area_techada: obra.built_area ?? null,
      area_libre: obra.free_area ?? null,
      area_total: obra.total_area ?? u.total_area ?? null,
      estado_obra: obra.status ?? null,
      pertenece_a: det.parent_unit_id ? codigoPorIdSp.get(String(det.parent_unit_id)) ?? `#${det.parent_unit_id}` : null,
      separada_el: fechaIso(det.separation_at),
      vendida_el: fechaIso(det.sold_at),
      entregada_el: fechaIso(det.handing_at),
      precio_venta: det.sale_price || null,
      estado_comercial: det.commercial_status ?? u.commercial_status ?? null,
      detalle: det,
    };
    inf.unidadesCompletadas++;
    if (!simulacion) {
      await prisma.unit.update({
        where: { id: crm.id },
        data: {
          floor: ajeno ? entero(det.floor) : crm.floor ?? entero(det.floor),
          bedrooms: ajeno ? entero(ex.dormitorios) : crm.bedrooms ?? entero(ex.dormitorios),
          bathrooms: ajeno ? entero(ex.banos) : crm.bathrooms ?? entero(ex.banos),
          extra: { ...extraActual, sperant_unit_id: u.id, sperant_code: u.code, sperant } as never,
        },
      });
    }
  }

  // Tipologías: imagen local en vez del enlace a Sperant.
  const tipologias = await prisma.typology.findMany({ where: { projectId } });
  for (const t of tipologias) {
    if (!deSperant(t.imageUrl) && !deSperant(t.planUrl)) continue;
    inf.tipologiasCompletadas++;
    if (simulacion) continue;
    const datos: { imageUrl?: string; planUrl?: string } = {};
    for (const campo of ['imageUrl', 'planUrl'] as const) {
      const url = t[campo];
      if (!deSperant(url)) continue;
      const ruta = await copiarImagen(organizationId, url!);
      if (ruta) { datos[campo] = ruta; inf.imagenesCopiadas++; } else inf.imagenesConError++;
    }
    if (Object.keys(datos).length) await prisma.typology.update({ where: { id: t.id }, data: datos });
  }

  // Inventario de otro proyecto de Sperant (Bordeaux metido en Domus): se quitan las unidades
  // que vinieron de Sperant y cuyo código no existe en este proyecto, y después las
  // tipologías que quedan sin unidades y no son de este proyecto. Los códigos que sí existen
  // en ambos (201, 302…) se corrigen con la comparativa de la importación, no aquí.
  const idsSp = new Set(d.units.map((u) => String(u.id)));
  const codigosSp = new Set(d.units.map((u) => String(u.name ?? u.code ?? '').trim()));
  const ajenas = (await prisma.unit.findMany({ where: { projectId } })).filter((u) => {
    const idSp = (u.extra as { sperant_unit_id?: unknown } | null)?.sperant_unit_id;
    return idSp != null && !idsSp.has(String(idSp)) && !codigosSp.has(u.code);
  });
  inf.unidadesDeOtroProyecto = ajenas.map((u) => u.code).sort();
  if (!simulacion && ajenas.length) await prisma.unit.deleteMany({ where: { id: { in: ajenas.map((u) => u.id) } } });
  const quitadas = new Set(ajenas.map((u) => u.id));
  const nombresSp = new Set(d.types.map((t) => String(t.name ?? '').trim().toLowerCase()));
  const deOtros = new Set((d.tiposOtrosProyectos ?? []).map((n) => n.toLowerCase()));
  const tipos = await prisma.typology.findMany({
    where: { projectId },
    include: { units: { select: { id: true } }, _count: { select: { intereses: true } } },
  });
  for (const t of tipos) {
    // Solo las que existen en otro proyecto de Sperant: nunca una creada a mano en el CRM.
    if (nombresSp.has(t.name.trim().toLowerCase()) || !deOtros.has(t.name.trim().toLowerCase())) continue;
    const usadas = t.units.filter((u) => !quitadas.has(u.id)).length;
    if (usadas || t._count.intereses) { inf.tipologiasAjenasEnUso.push(t.name); continue; }
    inf.tipologiasDeOtroProyecto.push(t.name);
    if (!simulacion) await prisma.typology.delete({ where: { id: t.id } });
  }

  // Proyecto: dirección si falta.
  const ub = ((d.proyectoDetalle ?? {}).ubication ?? {}) as Plano;
  if (!proyecto.address && ub.address) {
    inf.direccionCompletada = true;
    if (!simulacion) await prisma.project.update({ where: { id: projectId }, data: { address: String(ub.address) } });
  }
}

/** Arranca la importación real en segundo plano. */
export async function iniciarImportacion(organizationId: string, mapa: MapaImporte) {
  if (enMarcha.has(organizationId) || tareaEnCurso(organizationId)) throw new Error('Ya hay una tarea en curso');
  if (!hayDatos(organizationId)) throw new Error('Primero hay que exportar');
  enMarcha.add(organizationId);
  guardarEstado(organizationId, { ...leerEstado(organizationId), fase: 'importando', tarea: 'importar', inicio: new Date().toISOString(), latido: new Date().toISOString(), fin: undefined, error: null, hechos: 0 });
  setImmediate(() => {
    importar(organizationId, mapa, false)
      .then((informe) => {
        guardarEstado(organizationId, { ...leerEstado(organizationId), fase: 'importado', fin: new Date().toISOString(), error: null, importe: informe });
        logLine(`[sperant] importación terminada para ${organizationId}: ${informe.leads.nuevos} nuevos, ${informe.leads.fusionados} fusionados, ${informe.leads.errores} errores`);
      })
      .catch((err) => {
        logError('[sperant] importación falló:', err);
        guardarEstado(organizationId, { ...leerEstado(organizationId), fase: 'error', fin: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => enMarcha.delete(organizationId));
  });
}

/**
 * Asesores de Sperant presentes en los leads importados, con cuántos leads tiene cada uno y
 * quién los tiene hoy en el CRM. El nombre y correo sugeridos salen de los usuarios de Sperant
 * del export (si el asesor aparece ahí).
 */
export async function asesoresSperant(organizationId: string) {
  const d = leerDatos(organizationId);
  const usuariosSp = new Map((d?.users ?? []).map((u) => [String(u.username ?? ''), u]));
  const leads = await prisma.lead.findMany({
    where: { organizationId, attribution: { path: '$.sperant', not: Prisma.AnyNull } },
    select: { attribution: true, status: true, owner: { select: { id: true, name: true, email: true } } },
  });
  const porAsesor = new Map<string, { leads: number; abiertos: number; duenos: Map<string, { nombre: string; leads: number }> }>();
  for (const l of leads) {
    const usuario = String((l.attribution as { sperant?: { asesor?: string | null } }).sperant?.asesor ?? '') || '(sin asesor)';
    const fila = porAsesor.get(usuario) ?? { leads: 0, abiertos: 0, duenos: new Map() };
    fila.leads++;
    if (l.status === 'activo') fila.abiertos++;
    const clave = l.owner?.id ?? '';
    const dueno = fila.duenos.get(clave) ?? { nombre: l.owner ? `${l.owner.name} (${l.owner.email})` : 'sin asignar', leads: 0 };
    dueno.leads++;
    fila.duenos.set(clave, dueno);
    porAsesor.set(usuario, fila);
  }
  return [...porAsesor.entries()]
    .sort((a, b) => b[1].leads - a[1].leads)
    .map(([username, f]) => {
      const u = usuariosSp.get(username);
      return {
        username,
        leads: f.leads,
        abiertos: f.abiertos,
        duenosActuales: [...f.duenos.values()],
        sugerido: u ? { nombre: `${u.fname ?? ''} ${u.lname ?? ''}`.trim(), email: String(u.email ?? '') } : null,
      };
    });
}

export interface AsignacionAsesor {
  username: string;
  /** Usuario existente del CRM… */
  userId?: string;
  /** …o uno nuevo, que entra con enlace al correo (sin contraseña). */
  crear?: { name: string; email: string; role: 'asesor' | 'gerente' };
}

/**
 * Reasigna los leads importados según quién los llevaba en Sperant (`attribution.sperant.asesor`),
 * creando los usuarios que hagan falta. Pisa al dueño actual a propósito: es para deshacer una
 * asignación provisional. No toca leads que no vinieron de Sperant.
 *
 * Sin aviso por correo (serían cientos); cada lead recibe su asignación en el historial y una
 * actividad «Asesor → X (según Sperant)».
 */
export async function reasignarPorAsesor(organizationId: string, porUserId: string, asignaciones: AsignacionAsesor[]) {
  const resultado: { username: string; usuario: string; creado: boolean; leads: number }[] = [];
  for (const a of asignaciones) {
    let userId = a.userId ?? null;
    let creado = false;
    if (!userId && a.crear) {
      const email = a.crear.email.trim().toLowerCase();
      const existe = await prisma.user.findFirst({ where: { organizationId, email } });
      if (existe) {
        userId = existe.id;
      } else {
        const nuevo = await prisma.user.create({ data: { organizationId, email, name: a.crear.name.trim(), role: a.crear.role, active: true } });
        await prisma.auditLog.create({ data: { organizationId, userId: porUserId, action: 'user.create', entity: 'user', entityId: nuevo.id, meta: { email, role: a.crear.role, conPassword: false, origen: 'sperant' } as never } });
        userId = nuevo.id;
        creado = true;
      }
    }
    if (!userId) continue;
    const usuario = await prisma.user.findFirst({ where: { id: userId, organizationId } });
    if (!usuario) throw new Error(`El usuario para ${a.username} no existe`);
    if (!usuario.active) throw new Error(`${usuario.email} está desactivado`);

    const leads = await prisma.lead.findMany({
      where: {
        organizationId,
        attribution: a.username === '(sin asesor)' ? { path: '$.sperant.asesor', equals: Prisma.AnyNull } : { path: '$.sperant.asesor', equals: a.username },
      },
      select: { id: true, ownerId: true },
    });
    const cambiar = leads.filter((l) => l.ownerId !== userId).map((l) => l.id);
    const ahora = new Date();
    for (let i = 0; i < cambiar.length; i += 200) {
      const ids = cambiar.slice(i, i + 200);
      await prisma.$transaction([
        prisma.assignment.updateMany({ where: { leadId: { in: ids }, endedAt: null }, data: { endedAt: ahora } }),
        prisma.assignment.createMany({ data: ids.map((leadId) => ({ leadId, userId: userId!, reason: 'sperant' })) }),
        prisma.lead.updateMany({ where: { id: { in: ids } }, data: { ownerId: userId } }),
        prisma.activity.createMany({ data: ids.map((leadId) => ({ leadId, userId: porUserId, type: 'sistema', body: `Asesor → ${usuario.name} (según Sperant: ${a.username})` })) }),
      ]);
    }
    resultado.push({ username: a.username, usuario: `${usuario.name} (${usuario.email})`, creado, leads: cambiar.length });
  }
  await prisma.auditLog.create({ data: { organizationId, userId: porUserId, action: 'sperant.reasignar', meta: resultado as never } });
  return resultado;
}
