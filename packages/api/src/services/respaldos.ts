/**
 * Respaldos por organización: base de datos y archivos en un solo ZIP, del mismo instante.
 *
 * Por qué así y no con el backup de Plesk: la base y las carpetas de archivos (`uploads/`,
 * `privados/`) se respaldan en calendarios distintos, y restaurar una sin la otra deja fichas
 * apuntando a proformas o audios que no existen. Aquí las dos cosas salen juntas. Y como el
 * respaldo es por organización, se puede restaurar a un cliente sin tocar a los demás.
 *
 * Dos variantes del mismo contenido:
 *
 * - `interno`: el respaldo diario automático. Va entero, incluidos los hashes de contraseña y
 *   los tokens cifrados de Meta y WhatsApp, para que una restauración deje todo funcionando.
 *   Se guarda en el servidor (los últimos 3) y en el Drive de Lucuma (30 días).
 * - `cliente`: el que descarga el administrador de la organización desde Ajustes. Sin
 *   credenciales (contraseñas, tokens, llaves), y con planillas CSV legibles en Excel además
 *   de los datos completos en JSON. Cumple la exportación de la cláusula octava del contrato.
 *
 * No usa mysqldump: en Plesk la aplicación corre enjaulada y el binario puede no estar, y un
 * volcado de la base entera no se puede restaurar por organización. Se lee con Prisma.
 *
 * Quién lo dispara: el latido externo de `/cron/tick` llama a `respaldosAutomaticos()` sin
 * esperarla (un respaldo puede tardar más que el corte de 30 s del servicio de cron).
 * Restauración: `restaurar-respaldo.ts`. Documentación: docs/26-RESPALDOS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { guardarAjustes, leerAjustes } from '../lib/ajustes.js';
import { borrar, carpetaDeOrg, driveConfigurado, listar, subir } from '../lib/drive.js';
import { logError, logLine } from '../lib/log.js';
import { uploadsDir } from '../lib/media.js';
import { privadosDir } from '../lib/privados.js';
import { EscritorZip } from '../lib/zip.js';

export type Variante = 'interno' | 'cliente';

/** Versión del formato. Si cambia la estructura del ZIP, se sube y el restaurador lo comprueba. */
export const FORMATO = 1;

const RAIZ = path.join(privadosDir, '_respaldos');
const MANTENER_LOCAL = 3;
const MANTENER_DESCARGAS = 2;
const DIAS_EN_DRIVE = 30;

/**
 * Tablas que entran, en el orden en que se restauran (cada una después de aquellas a las
 * que apunta). Quedan fuera `login_tokens` (enlaces de acceso de un solo uso) y `jobs` (la
 * cola es de la instalación, no de una organización).
 */
export const TABLAS: { modelo: Prisma.ModelName; where: (org: string) => object }[] = [
  { modelo: 'Organization', where: (org) => ({ id: org }) },
  { modelo: 'CustomRole', where: (org) => ({ organizationId: org }) },
  { modelo: 'User', where: (org) => ({ organizationId: org }) },
  { modelo: 'Site', where: (org) => ({ organizationId: org }) },
  { modelo: 'Project', where: (org) => ({ organizationId: org }) },
  { modelo: 'Typology', where: (org) => ({ project: { organizationId: org } }) },
  { modelo: 'Unit', where: (org) => ({ project: { organizationId: org } }) },
  { modelo: 'Contact', where: (org) => ({ organizationId: org }) },
  { modelo: 'Stage', where: (org) => ({ organizationId: org }) },
  { modelo: 'Lead', where: (org) => ({ organizationId: org }) },
  { modelo: 'Proforma', where: (org) => ({ organizationId: org }) },
  { modelo: 'LeadTypologyInterest', where: (org) => ({ lead: { organizationId: org } }) },
  { modelo: 'LeadUnitInterest', where: (org) => ({ lead: { organizationId: org } }) },
  { modelo: 'Activity', where: (org) => ({ lead: { organizationId: org } }) },
  { modelo: 'Assignment', where: (org) => ({ lead: { organizationId: org } }) },
  { modelo: 'Form', where: (org) => ({ organizationId: org }) },
  { modelo: 'FormSubmission', where: (org) => ({ form: { organizationId: org } }) },
  { modelo: 'MetaPage', where: (org) => ({ organizationId: org }) },
  { modelo: 'MetaLead', where: (org) => ({ organizationId: org }) },
  { modelo: 'WaNumber', where: (org) => ({ organizationId: org }) },
  { modelo: 'WaConversation', where: (org) => ({ organizationId: org }) },
  { modelo: 'WaMessage', where: (org) => ({ conversation: { organizationId: org } }) },
  { modelo: 'NotaVoz', where: (org) => ({ organizationId: org }) },
  { modelo: 'AuditLog', where: (org) => ({ organizationId: org }) },
];

type Fila = Record<string, unknown>;
type Delegado = { findMany: (args: object) => Promise<Fila[]>; createMany: (args: object) => Promise<{ count: number }> };

export function delegado(modelo: Prisma.ModelName): Delegado {
  return (prisma as unknown as Record<string, Delegado>)[modelo[0]!.toLowerCase() + modelo.slice(1)]!;
}

/** Campos de la clave primaria, para paginar en un orden estable. */
function clave(modelo: Prisma.ModelName): string[] {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo)!;
  return m.primaryKey?.fields.slice() ?? m.fields.filter((f) => f.isId).map((f) => f.name);
}

async function leerTabla(modelo: Prisma.ModelName, where: object): Promise<Fila[]> {
  const orden = clave(modelo).map((c) => ({ [c]: 'asc' }));
  const filas: Fila[] = [];
  const LOTE = 2000;
  for (let salto = 0; ; salto += LOTE) {
    const lote = await delegado(modelo).findMany({ where, orderBy: orden, skip: salto, take: LOTE });
    filas.push(...lote);
    if (lote.length < LOTE) return filas;
  }
}

/** Lo que no sale en la descarga del cliente: credenciales, nunca datos de negocio. */
function sinCredenciales(modelo: Prisma.ModelName, filas: Fila[]): Fila[] {
  switch (modelo) {
    case 'Organization':
      return filas.map((f) => {
        const s = { ...((f.settings ?? {}) as Record<string, unknown>) };
        delete s.diagnostico;
        if (s.sperant && typeof s.sperant === 'object') s.sperant = { ...(s.sperant as object), tokenCifrado: null };
        return { ...f, settings: s };
      });
    case 'User':
      return filas.map((f) => ({ ...f, passwordHash: null }));
    case 'Site':
      return filas.map((f) => ({ ...f, secretKeyHash: '' }));
    case 'MetaPage':
    case 'WaNumber':
      return filas.map((f) => ({ ...f, accessTokenEnc: '' }));
    default:
      return filas;
  }
}

// ------------------------------------------------------------------ planillas

function csv(cabecera: string[], filas: unknown[][]): string {
  const celda = (c: unknown) => {
    const t = c === null || c === undefined ? '' : c instanceof Date ? c.toISOString() : String(c);
    return `"${t.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  };
  // BOM: sin él, Excel abre el UTF-8 como Latin-1 y las tildes salen rotas.
  return '﻿' + [cabecera, ...filas].map((f) => f.map(celda).join(',')).join('\n');
}

/** Planillas para abrir en Excel. Los datos completos están en `datos/`; esto es para leer. */
function planillas(t: Record<string, Fila[]>): Record<string, string> {
  const por = (modelo: string) => new Map((t[modelo] ?? []).map((f) => [f.id as string, f]));
  const contactos = por('Contact');
  const usuarios = por('User');
  const proyectos = por('Project');
  const etapas = por('Stage');
  const unidades = por('Unit');
  const tipologias = por('Typology');
  const leads = por('Lead');
  const nombre = (c?: Fila) => (c ? `${c.fname ?? ''} ${c.lname ?? ''}`.trim() : '');
  const nombreLead = (leadId: unknown) => nombre(contactos.get(leads.get(leadId as string)?.contactId as string));

  const tipInteres = new Map<string, string[]>();
  for (const i of t.LeadTypologyInterest ?? []) {
    const l = tipInteres.get(i.leadId as string) ?? [];
    l.push(String(tipologias.get(i.typologyId as string)?.name ?? ''));
    tipInteres.set(i.leadId as string, l);
  }
  const uniInteres = new Map<string, string[]>();
  for (const i of t.LeadUnitInterest ?? []) {
    const l = uniInteres.get(i.leadId as string) ?? [];
    l.push(String(unidades.get(i.unitId as string)?.code ?? ''));
    uniInteres.set(i.leadId as string, l);
  }

  const conv = por('WaConversation');
  return {
    'leads.csv': csv(
      ['fecha', 'nombre', 'apellido', 'telefono', 'email', 'documento', 'proyecto', 'unidad', 'tipologias_interes', 'unidades_interes', 'etapa', 'estado', 'nivel_interes', 'motivo_perdida', 'asesor', 'fuente', 'mensaje', 'ultima_actividad', 'id'],
      (t.Lead ?? []).map((l) => {
        const c = contactos.get(l.contactId as string);
        return [
          l.createdAt, c?.fname, c?.lname, c?.phone, c?.email, c?.document,
          proyectos.get(l.projectId as string)?.name, unidades.get(l.unitId as string)?.code,
          (tipInteres.get(l.id as string) ?? []).join(' | '), (uniInteres.get(l.id as string) ?? []).join(' | '),
          etapas.get(l.stageId as string)?.name, l.status, l.interestLevel, l.lostReason,
          usuarios.get(l.ownerId as string)?.name, l.source, l.message, l.lastActivityAt, l.id,
        ];
      })
    ),
    'contactos.csv': csv(
      ['nombre', 'apellido', 'telefono', 'email', 'documento', 'tipo_documento', 'creado', 'id'],
      (t.Contact ?? []).map((c) => [c.fname, c.lname, c.phone, c.email, c.document, c.documentType, c.createdAt, c.id])
    ),
    'seguimientos.csv': csv(
      ['fecha', 'lead', 'telefono', 'tipo', 'detalle', 'usuario', 'agendado_para', 'hecho', 'lead_id'],
      (t.Activity ?? []).map((a) => [
        a.createdAt, nombreLead(a.leadId), contactos.get(leads.get(a.leadId as string)?.contactId as string)?.phone,
        a.type, a.body, usuarios.get(a.userId as string)?.name, a.dueAt, a.doneAt, a.leadId,
      ])
    ),
    'proformas.csv': csv(
      ['numero', 'fecha', 'lead', 'proyecto', 'moneda', 'precio_lista', 'descuento_pct', 'precio_final', 'valida_hasta', 'emitida_por', 'archivo_pdf'],
      (t.Proforma ?? []).map((p) => [
        p.number, p.createdAt, nombreLead(p.leadId), proyectos.get(p.projectId as string)?.name, p.currency,
        p.listTotal, p.discountPct, p.finalTotal, p.validUntil, usuarios.get(p.createdById as string)?.name,
        `archivos/privados/${p.pdfPath}`,
      ])
    ),
    'unidades.csv': csv(
      ['proyecto', 'codigo', 'tipologia', 'tipo', 'estado', 'dormitorios', 'banos', 'area_m2', 'piso', 'precio', 'moneda'],
      (t.Unit ?? []).map((u) => [
        proyectos.get(u.projectId as string)?.name, u.code, tipologias.get(u.typologyId as string)?.name ?? u.typology,
        u.kind, u.status, u.bedrooms, u.bathrooms, u.areaM2, u.floor, u.price, u.currency,
      ])
    ),
    'whatsapp.csv': csv(
      ['fecha', 'contacto', 'telefono', 'direccion', 'tipo', 'texto', 'enviado_por', 'estado'],
      (t.WaMessage ?? []).map((m) => {
        const cv = conv.get(m.conversationId as string);
        return [
          m.createdAt, nombre(contactos.get(cv?.contactId as string)), cv?.waId ? `+${cv.waId}` : '',
          m.direction, m.type, m.body, usuarios.get(m.userId as string)?.name, m.status,
        ];
      })
    ),
  };
}

// ------------------------------------------------------------------ archivos

function* recorrer(dir: string, base = dir): Generator<{ abs: string; rel: string }> {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) yield* recorrer(abs, base);
    else if (e.isFile()) yield { abs, rel: path.relative(base, abs).split(path.sep).join('/') };
  }
}

/** Fecha y hora de Lima para nombres de archivo y la ventana nocturna. */
function lima(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return { sello: `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`, hora: Number(p.hour) };
}

function leeme(org: { name: string; slug: string }, variante: Variante, generado: Date, conteos: Record<string, number>) {
  return [
    `Respaldo del CRM Inmobiliario Lucuma`,
    `Organización: ${org.name} (${org.slug})`,
    `Generado: ${generado.toISOString()} (UTC)`,
    `Tipo: ${variante === 'cliente' ? 'descarga del cliente (sin contraseñas ni tokens de acceso)' : 'respaldo interno completo'}`,
    ``,
    `Contenido:`,
    `  planillas/   Leads, contactos, seguimientos, proformas, unidades y mensajes de WhatsApp en CSV (se abren con Excel).`,
    `  datos/       Todas las tablas en JSON, completas. Es lo que usa Lucuma para restaurar.`,
    `  archivos/    Proformas en PDF, notas de voz, archivos de WhatsApp, planos y renders.`,
    `  respaldo.json  Fecha, versión del formato y cantidad de registros por tabla.`,
    ``,
    `Registros:`,
    ...Object.entries(conteos).map(([k, v]) => `  ${k}: ${v}`),
    ``,
  ].join('\r\n');
}

export interface Resultado {
  ruta: string;
  nombre: string;
  bytes: number;
  conteos: Record<string, number>;
  archivos: number;
}

/** Arma el ZIP de una organización en `destino`. No lo sube ni lo registra. */
export async function generarRespaldo(organizationId: string, variante: Variante, destino: string): Promise<Resultado> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { id: true, slug: true, name: true } });
  const generado = new Date();
  const nombre = `respaldo-${org.slug}-${lima(generado).sello}${variante === 'interno' ? '-interno' : ''}.zip`;
  fs.mkdirSync(destino, { recursive: true });
  const ruta = path.join(destino, nombre);
  const zip = new EscritorZip(ruta + '.parcial');

  try {
    const tablas: Record<string, Fila[]> = {};
    const conteos: Record<string, number> = {};
    for (const t of TABLAS) {
      let filas = await leerTabla(t.modelo, t.where(organizationId));
      if (variante === 'cliente') filas = sinCredenciales(t.modelo, filas);
      tablas[t.modelo] = filas;
      conteos[t.modelo] = filas.length;
      zip.agregar(`datos/${t.modelo}.json`, JSON.stringify(filas), generado);
    }
    for (const [archivo, contenido] of Object.entries(planillas(tablas))) zip.agregar(`planillas/${archivo}`, contenido, generado);

    let archivos = 0;
    for (const [carpeta, dir] of [['uploads', uploadsDir], ['privados', privadosDir]] as const) {
      for (const f of recorrer(path.join(dir, organizationId))) {
        zip.agregar(`archivos/${carpeta}/${organizationId}/${f.rel}`, fs.readFileSync(f.abs), fs.statSync(f.abs).mtime);
        archivos++;
      }
    }

    zip.agregar(
      'respaldo.json',
      JSON.stringify({ formato: FORMATO, variante, generadoEl: generado.toISOString(), organizacion: org, conteos, archivos }, null, 2),
      generado
    );
    zip.agregar('LEEME.txt', leeme(org, variante, generado, conteos), generado);
    zip.cerrar();
    fs.renameSync(ruta + '.parcial', ruta);
    return { ruta, nombre, bytes: fs.statSync(ruta).size, conteos, archivos };
  } catch (err) {
    zip.descartar();
    throw err;
  }
}

/** Borra los ZIP más viejos de una carpeta y deja los `mantener` más recientes. */
function podar(dir: string, mantener: number) {
  if (!fs.existsSync(dir)) return;
  const zips = fs.readdirSync(dir).filter((f) => f.endsWith('.zip') || f.endsWith('.parcial')).sort().reverse();
  // Un .parcial es un respaldo que se cortó a medias (el proceso murió): nunca sirve.
  for (const f of zips.filter((x) => x.endsWith('.parcial'))) fs.rmSync(path.join(dir, f), { force: true });
  for (const f of zips.filter((x) => x.endsWith('.zip')).slice(mantener)) fs.rmSync(path.join(dir, f), { force: true });
}

export const dirAutomaticos = (org: string) => path.join(RAIZ, org, 'automaticos');
export const dirDescargas = (org: string) => path.join(RAIZ, org, 'descargas');

// ------------------------------------------------------------ estado y automático

export interface EstadoRespaldo {
  /** Último que llegó a Drive. Es el que cuenta: uno que solo está en el servidor no protege de perderlo. */
  ultimoOk: string | null;
  /** Último generado, haya subido o no. */
  ultimoLocal: string | null;
  ultimoIntento: string | null;
  archivo: string | null;
  bytes: number | null;
  /** En Drive: id del archivo, o el motivo por el que no se subió. */
  drive: { id: string } | { error: string } | null;
  error: string | null;
}

const ESTADO_VACIO: EstadoRespaldo = { ultimoOk: null, ultimoLocal: null, ultimoIntento: null, archivo: null, bytes: null, drive: null, error: null };

export async function leerEstadoRespaldo(organizationId: string): Promise<EstadoRespaldo> {
  const a = (await leerAjustes(organizationId)) as unknown as { respaldos?: EstadoRespaldo };
  return { ...ESTADO_VACIO, ...(a.respaldos ?? {}) };
}

async function guardarEstado(organizationId: string, estado: EstadoRespaldo) {
  await guardarAjustes(organizationId, { respaldos: estado } as never);
}

/** Respaldo interno + subida a Drive + poda, para una organización. */
export async function respaldarOrganizacion(organizationId: string): Promise<EstadoRespaldo> {
  const previo = await leerEstadoRespaldo(organizationId);
  const ahora = new Date().toISOString();
  try {
    const r = await generarRespaldo(organizationId, 'interno', dirAutomaticos(organizationId));
    podar(dirAutomaticos(organizationId), MANTENER_LOCAL);

    let drive: EstadoRespaldo['drive'] = { error: 'Google Drive no está configurado' };
    if (driveConfigurado()) {
      try {
        const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
        const carpetaId = await carpetaDeOrg(org.slug);
        drive = await subir(r.ruta, r.nombre, carpetaId);
        // Retención en Drive: lo de más de 30 días se borra. Solo ZIP de respaldo, por si
        // alguien dejó otra cosa en la carpeta.
        const limite = Date.now() - DIAS_EN_DRIVE * 24 * 3600 * 1000;
        for (const f of await listar(carpetaId)) {
          if (f.name.startsWith('respaldo-') && f.name.endsWith('.zip') && new Date(f.createdTime).getTime() < limite) await borrar(f.id);
        }
      } catch (err) {
        drive = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // Sin Drive el respaldo existe, pero solo en el servidor: cuenta como fallo para que
    // se reintente en una hora y se vea en rojo en Ajustes.
    const subio = 'id' in drive;
    const estado: EstadoRespaldo = {
      ultimoOk: subio ? ahora : previo.ultimoOk,
      ultimoLocal: ahora,
      ultimoIntento: ahora,
      archivo: r.nombre,
      bytes: r.bytes,
      drive,
      error: subio ? null : `Respaldo generado en el servidor, pero no se subió a Drive: ${(drive as { error: string }).error}`,
    };
    await guardarEstado(organizationId, estado);
    logLine(`respaldo: ${r.nombre} (${Math.round(r.bytes / 1024)} KB, ${r.archivos} archivos)${subio ? ' subido a Drive' : ' SIN Drive'}`);
    return estado;
  } catch (err) {
    const estado: EstadoRespaldo = { ...previo, ultimoIntento: ahora, error: err instanceof Error ? err.message : String(err) };
    await guardarEstado(organizationId, estado);
    logError(`respaldo: falló el de ${organizationId}`, err);
    return estado;
  }
}

/**
 * ¿Le toca a esta organización? Una vez al día, de madrugada; si falló, a la hora.
 *
 * Sin Drive configurado no tiene sentido reintentar cada hora (va a fallar igual): se mide
 * contra el último generado en el servidor y queda en uno diario.
 */
function toca(e: EstadoRespaldo, ahora = Date.now()): boolean {
  const horas = (iso: string | null) => (iso ? (ahora - new Date(iso).getTime()) / 3600_000 : Infinity);
  if (horas(e.ultimoIntento) < 1) return false;
  const ultimo = driveConfigurado() ? e.ultimoOk : e.ultimoLocal;
  if (!ultimo) return true; // nunca hubo uno: no esperar a la madrugada
  const h = lima(new Date(ahora)).hora;
  return (horas(ultimo) >= 20 && h >= 2 && h < 6) || horas(ultimo) >= 28;
}

let enMarcha = false;
const CERROJO = path.join(RAIZ, '.en-marcha');

/**
 * Lo llama cada latido. Casi siempre no hace nada: mira si a alguna organización le toca y
 * sale. Un cerrojo en disco evita que dos procesos de Passenger respalden a la vez; si un
 * proceso murió con el cerrojo puesto, a las 2 horas se considera abandonado.
 */
export async function respaldosAutomaticos(): Promise<void> {
  if (!env.respaldosActivos || enMarcha) return;
  enMarcha = true;
  let cerrojo = false;
  try {
    const orgs = await prisma.organization.findMany({ select: { id: true } });
    const pendientes: string[] = [];
    for (const o of orgs) if (toca(await leerEstadoRespaldo(o.id))) pendientes.push(o.id);
    if (pendientes.length === 0) return;

    fs.mkdirSync(RAIZ, { recursive: true });
    try {
      fs.writeFileSync(CERROJO, String(process.pid), { flag: 'wx' });
    } catch {
      if (Date.now() - fs.statSync(CERROJO).mtimeMs < 2 * 3600_000) return;
      fs.writeFileSync(CERROJO, String(process.pid));
    }
    cerrojo = true;
    for (const id of pendientes) await respaldarOrganizacion(id);
  } catch (err) {
    logError('respaldo: fallo en la ronda automática', err);
  } finally {
    if (cerrojo) fs.rmSync(CERROJO, { force: true });
    enMarcha = false;
  }
}

// ------------------------------------------------------------------ descargas

export function listarZips(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.zip'))
    .sort()
    .reverse()
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { nombre: f, bytes: st.size, creadoEl: st.mtime.toISOString() };
    });
}

/** Respaldo para que el cliente lo descargue. Se guardan los dos últimos. */
export async function generarDescarga(organizationId: string): Promise<Resultado> {
  const r = await generarRespaldo(organizationId, 'cliente', dirDescargas(organizationId));
  podar(dirDescargas(organizationId), MANTENER_DESCARGAS);
  return r;
}
