#!/usr/bin/env node
/**
 * Exporta todo lo útil de una cuenta de Sperant (API v3) a JSON crudo + CSV.
 *
 * Uso:
 *   SPERANT_TOKEN=xxx node scripts/sperant-export.mjs [--out carpeta] [--project 2] [--solo-listados]
 *
 *   --out            carpeta de salida (por defecto ./sperant-export-<fecha>)
 *   --project N      proyecto para tipologías/unidades (repetible; por defecto todos los que liste /v3/projects)
 *   --solo-listados  NO pide el detalle por lead (por defecto sí: el listado /v3/clients solo trae
 *                    8 columnas; created_at, documento, estado y observación están en /v3/clients/{id},
 *                    y etapa, asesor, canal y medio en /v3/clients/{id}/projects → 2 requests por lead)
 *   --base URL       por defecto https://api.sperant.com (el panel bastion.sperantone.com NO es la API)
 *
 * Notas de la API: Authorization: <token> a secas (no Bearer); JSON:API con `data[]` y
 * `attributes`; paginación de 20 por defecto; límite 15 req/s. Este script va a ~5 req/s.
 * No escribe nada en Sperant: solo GET.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, def) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : def; };
const flags = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const has = (n) => args.includes(n);

const TOKEN = process.env.SPERANT_TOKEN;
if (!TOKEN) { console.error('Falta SPERANT_TOKEN en el entorno.'); process.exit(1); }
const BASE = (flag('--base', 'https://api.sperant.com')).replace(/\/$/, '');
const OUT = flag('--out', `./sperant-export-${new Date().toISOString().slice(0, 10)}`);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ultimo = 0;
async function get(path) {
  const espera = 200 - (Date.now() - ultimo);
  if (espera > 0) await sleep(espera);
  ultimo = Date.now();
  const r = await fetch(BASE + path, { headers: { Accept: 'application/json', Authorization: TOKEN } });
  const texto = await r.text();
  let body = null;
  try { body = JSON.parse(texto); } catch { /* no JSON */ }
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${path}: ${texto.slice(0, 300)}`);
  return body;
}

/** Aplana un recurso JSON:API ({id, type, attributes}) a un objeto plano. */
function plano(row) {
  if (row && typeof row === 'object' && row.attributes && typeof row.attributes === 'object') {
    return { id: row.id, ...row.attributes };
  }
  return row;
}

/** Recorre todas las páginas de un listado. Soporta links.next, meta.last_page y «hasta que venga vacío». */
async function todas(path) {
  const filas = [];
  const vistos = new Set();
  let pagina = 1;
  const sep = path.includes('?') ? '&' : '?';
  for (;;) {
    const body = await get(`${path}${sep}page=${pagina}&per_page=100`);
    const data = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
    let nuevos = 0;
    for (const row of data) {
      const p = plano(row);
      const clave = p?.id ?? JSON.stringify(p);
      if (vistos.has(clave)) continue;
      vistos.add(clave); filas.push(p); nuevos++;
    }
    process.stdout.write(`  ${path} página ${pagina}: ${data.length} filas (${filas.length} acumuladas)\r`);
    const next = body?.links?.next ?? body?.meta?.next_page_url ?? null;
    const last = body?.meta?.last_page ?? body?.meta?.pagination?.total_pages ?? null;
    if (data.length === 0 || nuevos === 0) break;
    if (last != null && pagina >= Number(last)) break;
    if (next === null && last == null && data.length < 20) break; // una sola página
    pagina++;
    if (pagina > 2000) break; // red de seguridad
  }
  process.stdout.write('\n');
  return filas;
}

function csv(filas, archivo) {
  if (!filas.length) { writeFileSync(archivo, ''); return; }
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))];
  const esc = (v) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lineas = [cols.join(','), ...filas.map((f) => cols.map((c) => esc(f[c])).join(','))];
  writeFileSync(archivo, '﻿' + lineas.join('\n'), 'utf8');
}

function guardar(nombre, filas) {
  writeFileSync(join(OUT, `${nombre}.json`), JSON.stringify(filas, null, 2));
  csv(filas, join(OUT, `${nombre}.csv`));
  console.log(`✔ ${nombre}: ${filas.length} filas`);
}

async function intentar(nombre, path) {
  try { const filas = await todas(path); guardar(nombre, filas); return filas; }
  catch (e) { console.warn(`✖ ${nombre}: ${e.message}`); return []; }
}

console.log(`Exportando desde ${BASE} a ${OUT}`);

// 1) Catálogos (chicos, sirven para traducir ids a nombres). /v3/custom_fields, /v3/extra_fields y
//    /v3/projects/{id}/custom_fields dan 404 en la cuenta de Bastión (2026-10-15).
await intentar('input_channels', '/v3/input_channels');
await intentar('captation_ways', '/v3/captation_ways');
await intentar('interest_types', '/v3/interest_types');
await intentar('document_types', '/v3/document_types');
await intentar('users', '/v3/users');

// 2) Proyectos e inventario
const proyectos = await intentar('projects', '/v3/projects');
const ids = flags('--project').length ? flags('--project') : proyectos.map((p) => p.id).filter(Boolean);
for (const id of ids) {
  await intentar(`project_${id}_types`, `/v3/projects/${id}/types`);
  await intentar(`project_${id}_units`, `/v3/projects/${id}/units`);
}

// 3) Leads (lo importante) y proformas
const clientes = await intentar('clients', '/v3/clients');
await intentar('budgets', '/v3/budgets');

// 4) Detalle por lead (2 requests por lead, ~0,4 s cada lead → 1.700 leads ≈ 12 min)
if (!has('--solo-listados') && clientes.length) {
  const detalle = [];
  const rel = [];
  let n = 0;
  for (const c of clientes) {
    n++;
    try {
      const body = await get(`/v3/clients/${c.id}`);
      detalle.push(plano(body?.data ?? body));
    } catch (e) { detalle.push({ id: c.id, error: e.message }); }
    try {
      const body = await get(`/v3/clients/${c.id}/projects`);
      const data = Array.isArray(body?.data) ? body.data : [];
      if (!data.length) rel.push({ client_id: c.id, id: null });
      for (const row of data) rel.push({ client_id: c.id, ...plano(row) });
    } catch (e) { rel.push({ client_id: c.id, error: e.message }); }
    if (n % 25 === 0) process.stdout.write(`  detalle por lead: ${n}/${clientes.length}\r`);
  }
  process.stdout.write('\n');
  guardar('clients_detalle', detalle);
  guardar('client_projects', rel);
}

// 5) Proformas: titulares (= cliente) y unidades de cada una
const presupuestos = JSON.parse(readFileSync(join(OUT, 'budgets.json'), 'utf8'));
if (presupuestos.length) {
  const det = [];
  for (const b of presupuestos) {
    const fila = { ...b, titulars: [], units: [] };
    try { fila.titulars = ((await get(`/v3/budgets/${b.id}/titulars`))?.data ?? []).map(plano); } catch (e) { fila.error_titulars = e.message; }
    try { fila.units = ((await get(`/v3/budgets/${b.id}/units`))?.data ?? []).map(plano); } catch (e) { fila.error_units = e.message; }
    det.push(fila);
  }
  guardar('budgets_detalle', det);
}

console.log('Listo. Revisa clients_detalle.csv (created_at, status, observación) y client_projects.csv (etapa, asesor, canal, medio). Total esperado: meta.page.total del listado.');
