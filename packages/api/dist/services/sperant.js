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
import { descifrar } from '../lib/secretos.js';
import { upsertContacto } from './capture.js';
const BASE = 'https://api.sperant.com';
/** Límite de Sperant: 15 req/s. Se va a 5 para no competir con el plugin de la web. */
const PAUSA_MS = 200;
/** Cada cuántos leads se guarda el avance (y se actualiza el latido). */
const CADA = 20;
/** Si el latido tiene más de esto, la tarea se da por muerta y se puede reanudar. */
const LATIDO_MUERTO_MS = 3 * 60 * 1000;
// ------------------------------------------------------------------ archivos
function dir(organizationId) {
    const d = path.join(privadosDir, organizationId, 'sperant');
    fs.mkdirSync(d, { recursive: true });
    return d;
}
const rutaEstado = (org) => path.join(dir(org), 'estado.json');
const rutaDatos = (org) => path.join(dir(org), 'datos.json');
export function leerEstado(organizationId) {
    try {
        return JSON.parse(fs.readFileSync(rutaEstado(organizationId), 'utf8'));
    }
    catch {
        return { fase: 'sin_token' };
    }
}
function guardarEstado(organizationId, estado) {
    fs.writeFileSync(rutaEstado(organizationId), JSON.stringify(estado, null, 1));
}
function leerDatos(organizationId) {
    try {
        return JSON.parse(fs.readFileSync(rutaDatos(organizationId), 'utf8'));
    }
    catch {
        return null;
    }
}
function guardarDatos(organizationId, datos) {
    // Escritura atómica: si el proceso muere a mitad, queda la versión anterior y no un JSON roto.
    const tmp = rutaDatos(organizationId) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(datos));
    fs.renameSync(tmp, rutaDatos(organizationId));
}
export function hayDatos(organizationId) {
    return fs.existsSync(rutaDatos(organizationId));
}
/** Borra el export (datos personales) una vez terminada la migración. */
export function borrarDatos(organizationId) {
    for (const f of [rutaDatos(organizationId), rutaDatos(organizationId) + '.tmp']) {
        try {
            fs.unlinkSync(f);
        }
        catch { /* no existía */ }
    }
    const e = leerEstado(organizationId);
    guardarEstado(organizationId, { fase: 'listo', importe: e.importe });
}
/** ¿Hay una tarea viva? Viva = en marcha y con latido reciente. */
export function tareaEnCurso(organizationId) {
    const e = leerEstado(organizationId);
    if (e.fase !== 'exportando' && e.fase !== 'importando')
        return false;
    const latido = e.latido ? Date.parse(e.latido) : 0;
    return Date.now() - latido < LATIDO_MUERTO_MS;
}
// ------------------------------------------------------------------ cliente HTTP
async function token(organizationId) {
    const a = await leerAjustes(organizationId);
    if (!a.sperant?.tokenCifrado)
        throw new Error('No hay token de Sperant guardado');
    return descifrar(a.sperant.tokenCifrado);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(tok, ruta) {
    await sleep(PAUSA_MS);
    const r = await fetch(BASE + ruta, { headers: { Accept: 'application/json', Authorization: tok } });
    const texto = await r.text();
    if (!r.ok)
        throw new Error(`Sperant HTTP ${r.status} en ${ruta}: ${texto.slice(0, 200)}`);
    try {
        return JSON.parse(texto);
    }
    catch {
        throw new Error(`Sperant devolvió algo que no es JSON en ${ruta}`);
    }
}
/** {id, type, attributes} → {id, ...attributes}. */
function plano(row) {
    if (row && typeof row === 'object' && 'attributes' in row) {
        const r = row;
        return { id: r.id, ...(r.attributes ?? {}) };
    }
    return (row ?? {});
}
function datos(body) {
    const d = body.data;
    return Array.isArray(d) ? d.map(plano) : [];
}
/** Todas las páginas de un listado (JSON:API con links.next; per_page se ignora, son 20). */
async function todas(tok, ruta, alAvanzar) {
    const filas = [];
    const vistos = new Set();
    const sep = ruta.includes('?') ? '&' : '?';
    for (let pagina = 1; pagina < 5000; pagina++) {
        const body = await get(tok, `${ruta}${sep}page=${pagina}`);
        const d = datos(body);
        let nuevos = 0;
        for (const f of d) {
            const k = String(f.id ?? JSON.stringify(f));
            if (vistos.has(k))
                continue;
            vistos.add(k);
            filas.push(f);
            nuevos++;
        }
        alAvanzar?.(filas.length);
        const links = (body.links ?? {});
        const esUltima = !links.next || links.next === links.last && pagina >= Number(new URL(links.last).searchParams.get('page') ?? pagina);
        if (d.length === 0 || nuevos === 0 || esUltima)
            break;
    }
    return filas;
}
// ------------------------------------------------------------------ probar
export async function probar(organizationId) {
    const tok = await token(organizationId);
    const proyectos = datos(await get(tok, '/v3/projects'));
    const clientes = await get(tok, '/v3/clients?page=1');
    const meta = clientes.meta;
    return {
        ok: true,
        proyectos: proyectos.map((p) => ({ id: Number(p.id), code: String(p.code ?? ''), name: String(p.name ?? '') })),
        totalLeads: meta?.page?.total ?? datos(clientes).length,
    };
}
// ------------------------------------------------------------------ exportar
const enMarcha = new Set();
/**
 * Arranca (o reanuda) la exportación en segundo plano. Devuelve enseguida.
 * Lanza si ya hay una viva.
 */
export async function iniciarExportacion(organizationId) {
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
async function exportar(organizationId, tok, sperantProjectId) {
    const previo = leerDatos(organizationId);
    const d = previo ?? {
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
    const latir = (hechos, total) => guardarEstado(organizationId, { ...leerEstado(organizationId), latido: new Date().toISOString(), hechos, total });
    // 1) Catálogos, proyectos, usuarios e inventario: baratos, se rehacen siempre.
    for (const [nombre, ruta] of [
        ['input_channels', '/v3/input_channels'],
        ['captation_ways', '/v3/captation_ways'],
        ['interest_types', '/v3/interest_types'],
        ['document_types', '/v3/document_types'],
    ]) {
        d.catalogos[nombre] = await todas(tok, ruta);
    }
    d.projects = await todas(tok, '/v3/projects');
    d.users = await todas(tok, '/v3/users');
    const pid = sperantProjectId ?? (d.projects[0] ? Number(d.projects[0].id) : null);
    if (pid) {
        d.types = await todas(tok, `/v3/projects/${pid}/types`);
        d.units = await todas(tok, `/v3/projects/${pid}/units`);
    }
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
    const completos = [];
    for (const b of budgets) {
        const ya = previos.get(String(b.id));
        if (ya && Array.isArray(ya.titulars)) {
            completos.push(ya);
            continue;
        }
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
function cuenta(valores) {
    const m = new Map();
    for (const v of valores) {
        const k = v === null || v === undefined || v === '' ? '(vacío)' : String(v);
        m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([valor, n]) => ({ valor, n })).sort((a, b) => b.n - a.n);
}
function fecha(ts) {
    if (typeof ts === 'number' && ts > 0)
        return new Date(ts * 1000);
    if (typeof ts === 'string' && ts) {
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}
/**
 * Sperant rellena el documento con `auto-123456` cuando el asesor no lo cargó. No es un
 * documento: guardarlo ensucia la ficha y la deduplicación por DNI.
 */
const docReal = (v) => (v && !/^auto-/i.test(v) ? v : null);
function unir(d) {
    const out = [];
    for (const c of d.clientes) {
        const id = String(c.id);
        const det = d.detalle[id] ?? {};
        const rel = (d.proyectos[id] ?? [])[0] ?? {};
        const s = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
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
    return out;
}
export function resumen(organizationId) {
    const d = leerDatos(organizationId);
    if (!d)
        return null;
    const leads = unir(d);
    const porMes = cuenta(leads.map((l) => (l.createdAt ? l.createdAt.toISOString().slice(0, 7) : null))).sort((a, b) => a.valor.localeCompare(b.valor));
    const fechas = leads.map((l) => l.createdAt).filter((x) => !!x).sort((a, b) => a.getTime() - b.getTime());
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
        inventario: {
            tipologias: d.types.map((t) => String(t.name ?? t.id)),
            unidades: d.units.length,
            porEstado: cuenta(d.units.map((u) => u.commercial_status)),
            porTipo: cuenta(d.units.map((u) => u.property_type)),
        },
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
export async function sugerirMapa(organizationId) {
    const r = resumen(organizationId);
    if (!r)
        return null;
    const [etapas, usuarios] = await Promise.all([
        prisma.stage.findMany({ where: { organizationId }, orderBy: { position: 'asc' } }),
        prisma.user.findMany({ where: { organizationId, active: true }, select: { id: true, email: true, name: true } }),
    ]);
    const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/s$/, '');
    const mapaEtapas = {};
    for (const e of r.leads.etapas) {
        const k = norm(e.valor);
        const igual = etapas.find((x) => norm(x.name) === k);
        mapaEtapas[e.valor] = igual ? igual.id : /desestim|perdid/.test(k) ? 'crear_perdida' : 'crear';
    }
    const mapaAsesores = {};
    for (const a of r.leads.asesores) {
        const su = r.usuarios.find((u) => u.username === a.valor);
        const porCorreo = su ? usuarios.find((u) => u.email.toLowerCase() === su.email.toLowerCase()) : undefined;
        const porNombre = usuarios.find((u) => norm(u.name).includes(norm(a.valor)) || norm(a.valor).includes(norm(u.name.split(' ')[0] ?? '')));
        mapaAsesores[a.valor] = porCorreo?.id ?? porNombre?.id ?? null;
    }
    return { etapas: mapaEtapas, asesores: mapaAsesores, etapasCrm: etapas.map((e) => ({ id: e.id, name: e.name, isLost: e.isLost, isWon: e.isWon })), usuariosCrm: usuarios };
}
// ------------------------------------------------------------------ importar
const FUENTE = {
    meta: 'meta_ads',
    whatsapp: 'whatsapp',
    'contacto web': 'web_form',
};
const INTERES = { bajo: 1, intermedio: 2, alto: 3 };
/** Estados comerciales vistos en Bastión: disponible, no disponible, pre-asignado. */
function estadoUnidad(v) {
    const t = String(v ?? '').toLowerCase();
    if (t === 'disponible')
        return 'disponible';
    if (/vendid|entregad/.test(t))
        return 'vendido';
    if (/separad|reservad|asignad|bloquead/.test(t))
        return 'reservado';
    return 'no_disponible';
}
/** Tipos vistos: «departamento flat», «departamento duplex», «estacionamiento», «depósito». */
function tipoUnidad(v) {
    const t = String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/departamento|dpto|flat|duplex|penthouse|vivienda/.test(t))
        return 'departamento';
    if (/estacionamiento|cochera|parking/.test(t))
        return 'estacionamiento';
    if (/deposito|bodega/.test(t))
        return 'deposito';
    if (/lote|terreno/.test(t))
        return 'lote';
    if (/oficina|local/.test(t))
        return 'oficina';
    return 'otro';
}
function soles(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v.toLocaleString('es-PE', { maximumFractionDigits: 0 }) : String(n ?? '');
}
const fechaCorta = (d) => (d ? d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
/**
 * Importa (o simula). Con `simulacion` no escribe nada en la base.
 *
 * Idempotencia: los leads ya importados se reconocen por `attribution.sperant.client_id`.
 * Fusión: si el contacto ya tiene un lead activo en el mismo proyecto (por ejemplo uno que
 * entró por WhatsApp durante el demo), no se crea otro: se le anota la procedencia y se
 * completan dueño y etapa si estaban vacíos.
 */
export async function importar(organizationId, mapa, simulacion) {
    const d = leerDatos(organizationId);
    if (!d)
        throw new Error('No hay datos exportados');
    const project = await prisma.project.findFirst({ where: { id: mapa.crmProjectId, organizationId } });
    if (!project)
        throw new Error('El proyecto del CRM no existe');
    const informe = {
        simulacion,
        leads: { total: 0, nuevos: 0, fusionados: 0, yaImportados: 0, omitidos: 0, sinEtapa: 0, sinAsesor: 0, errores: 0 },
        contactos: { nuevos: 0, existentes: 0 },
        unidades: { creadas: 0, actualizadas: 0, sinCambios: 0, pendientes: 0, tipologiasCreadas: 0, diferencias: [] },
        proformas: { notas: 0 },
        etapasCreadas: [],
        erroresDetalle: [],
    };
    const latir = (hechos, total) => {
        if (!simulacion)
            guardarEstado(organizationId, { ...leerEstado(organizationId), latido: new Date().toISOString(), hechos, total });
    };
    // --- etapas: resolver `crear` / `crear_perdida` (de verdad solo si no es simulación)
    const etapas = await prisma.stage.findMany({ where: { organizationId }, orderBy: { position: 'asc' } });
    const etapaPorSegmento = new Map();
    let posicion = (etapas[etapas.length - 1]?.position ?? 0) + 1;
    for (const [segmento, destino] of Object.entries(mapa.etapas)) {
        if (destino === null) {
            etapaPorSegmento.set(segmento, null);
            continue;
        }
        if (destino === 'crear' || destino === 'crear_perdida') {
            const isLost = destino === 'crear_perdida';
            // Si una pasada anterior ya la creó, se reutiliza: correr la importación otra vez no
            // puede duplicar etapas.
            const yaCreada = etapas.find((e) => e.name.trim().toLowerCase() === segmento.trim().toLowerCase());
            if (yaCreada) {
                etapaPorSegmento.set(segmento, yaCreada);
                continue;
            }
            informe.etapasCreadas.push(segmento);
            if (simulacion) {
                etapaPorSegmento.set(segmento, { id: `(nueva) ${segmento}`, isLost, isWon: false });
                continue;
            }
            const slugBase = segmento.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'etapa';
            let slug = slugBase;
            for (let i = 2; etapas.some((e) => e.slug === slug); i++)
                slug = `${slugBase}-${i}`;
            const nueva = await prisma.stage.create({ data: { organizationId, slug, name: segmento, position: posicion++, isLost } });
            etapas.push(nueva);
            etapaPorSegmento.set(segmento, nueva);
            continue;
        }
        const e = etapas.find((x) => x.id === destino);
        if (!e)
            throw new Error(`La etapa ${destino} no existe`);
        etapaPorSegmento.set(segmento, e);
    }
    const usuarios = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
    const usuarioOk = new Set(usuarios.map((u) => u.id));
    // --- inventario
    if (mapa.importarUnidades) {
        const tipologias = await prisma.typology.findMany({ where: { projectId: project.id } });
        const porNombre = new Map(tipologias.map((t) => [t.name.trim().toLowerCase(), t.id]));
        const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
        for (const t of d.types) {
            const nombre = String(t.name ?? '').trim();
            if (!nombre)
                continue;
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
                    const actual = tipologias.find((x) => x.id === idExistente);
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
            }
            else {
                porNombre.set(nombre.toLowerCase(), `(nueva) ${nombre}`);
            }
        }
        const existentes = await prisma.unit.findMany({ where: { projectId: project.id } });
        const porCodigo = new Map(existentes.map((u) => [u.code, u]));
        const aprobadas = new Set(mapa.unidadesAprobadas ?? []);
        const ETIQUETA = { price: 'precio', currency: 'moneda', status: 'estado', kind: 'tipo', areaM2: 'área m²', typology: 'tipología' };
        for (const u of d.units) {
            const code = String(u.name ?? u.code ?? '').trim();
            if (!code)
                continue;
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
                extra: { sperant_unit_id: u.id, sperant_code: u.code },
            };
            const existente = porCodigo.get(code);
            if (existente) {
                // Comparar campo a campo. Solo lo que difiere se muestra y solo lo aprobado se escribe.
                const cambios = {};
                const comparar = (campo, crm, sp) => {
                    const a = crm === null || crm === undefined ? null : typeof crm === 'object' ? Number(crm) : crm;
                    const b = sp === null || sp === undefined ? null : sp;
                    if (String(a ?? '') !== String(b ?? ''))
                        cambios[ETIQUETA[campo]] = { crm: a, sperant: b };
                };
                comparar('price', existente.price, datosUnidad.price);
                comparar('currency', existente.currency, datosUnidad.currency);
                comparar('status', existente.status, datosUnidad.status);
                comparar('kind', existente.kind, datosUnidad.kind);
                comparar('areaM2', existente.areaM2, datosUnidad.areaM2);
                comparar('typology', existente.typology, datosUnidad.typology);
                if (Object.keys(cambios).length === 0) {
                    informe.unidades.sinCambios++;
                    continue;
                }
                const aprobada = aprobadas.has(code);
                informe.unidades.diferencias.push({ code, cambios, aprobada });
                if (!aprobada) {
                    informe.unidades.pendientes++;
                    continue;
                }
                informe.unidades.actualizadas++;
                if (!simulacion) {
                    await prisma.unit.update({ where: { id: existente.id }, data: datosUnidad });
                    if (cambios.precio) {
                        await prisma.auditLog.create({
                            data: {
                                organizationId,
                                userId: mapa.userId ?? null,
                                action: 'unit.price',
                                entity: 'unit',
                                entityId: existente.id,
                                meta: { code, projectId: project.id, de: cambios.precio.crm, a: cambios.precio.sperant, origen: 'sperant' },
                            },
                        });
                    }
                }
            }
            else {
                informe.unidades.creadas++;
                if (!simulacion)
                    await prisma.unit.create({ data: { ...datosUnidad, code, projectId: project.id } });
            }
        }
    }
    // --- proformas por cliente (titular.id = client id)
    const proformasPorCliente = new Map();
    if (mapa.importarProformas) {
        for (const b of d.budgets) {
            for (const t of b.titulars ?? []) {
                const cid = Number(t.id);
                if (!proformasPorCliente.has(cid))
                    proformasPorCliente.set(cid, []);
                proformasPorCliente.get(cid).push(b);
            }
        }
    }
    // --- leads ya importados (idempotencia)
    const previos = await prisma.lead.findMany({
        where: { organizationId, projectId: project.id },
        select: { id: true, attribution: true },
    });
    const yaImportado = new Set();
    for (const p of previos) {
        const a = p.attribution;
        if (a?.sperant?.client_id)
            yaImportado.add(Number(a.sperant.client_id));
        for (const id of a?.sperant_fusiones ?? [])
            yaImportado.add(Number(id));
    }
    const leads = unir(d).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    informe.leads.total = leads.length;
    let n = 0;
    for (const l of leads) {
        n++;
        if (n % CADA === 0)
            latir(n, leads.length);
        try {
            if (yaImportado.has(l.id)) {
                informe.leads.yaImportados++;
                continue;
            }
            const segmento = l.segment ?? '(vacío)';
            if (!(segmento in mapa.etapas)) {
                informe.leads.sinEtapa++;
            }
            const etapa = etapaPorSegmento.get(segmento) ?? null;
            if (segmento in mapa.etapas && etapa === null) {
                informe.leads.omitidos++;
                continue;
            }
            const ownerId = l.seller ? mapa.asesores[l.seller] ?? null : null;
            if (!ownerId || !usuarioOk.has(ownerId))
                informe.leads.sinAsesor++;
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
            if (existente)
                informe.contactos.existentes++;
            else
                informe.contactos.nuevos++;
            const status = etapa?.isLost ? 'perdido' : etapa?.isWon ? 'ganado' : 'activo';
            const attribution = {
                sperant: {
                    client_id: l.id,
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
            const proformas = proformasPorCliente.get(l.id) ?? [];
            // ¿Ya hay un lead activo de este contacto en el proyecto? → fusionar.
            const leadActivo = existente
                ? await prisma.lead.findFirst({ where: { organizationId, contactId: existente.id, projectId: project.id, status: 'activo' }, select: { id: true, ownerId: true, stageId: true } })
                : null;
            if (leadActivo) {
                informe.leads.fusionados++;
                informe.proformas.notas += proformas.length;
                if (!simulacion) {
                    // Si el lead ya venía de Sperant (dos registros de la misma persona en Sperant, mismo
                    // DNI), se conserva la marca del primero y el segundo se anota en `sperant_fusiones`:
                    // así los dos ids cuentan como importados en la siguiente pasada.
                    const actual = ((await prisma.lead.findUnique({ where: { id: leadActivo.id }, select: { attribution: true } }))?.attribution ?? {});
                    const nuevaAttr = actual.sperant
                        ? {
                            ...actual,
                            sperant_fusiones: [...(actual.sperant_fusiones ?? []), l.id],
                            sperant_fusiones_datos: { ...(actual.sperant_fusiones_datos ?? {}), [l.id]: l.crudo },
                        }
                        : { ...actual, ...attribution };
                    await prisma.lead.update({
                        where: { id: leadActivo.id },
                        data: {
                            ownerId: leadActivo.ownerId ?? owner,
                            interestLevel: l.interest ? INTERES[l.interest] ?? undefined : undefined,
                            attribution: nuevaAttr,
                        },
                    });
                    await prisma.activity.create({ data: { leadId: leadActivo.id, type: 'sistema', body: `Fusionado con el lead de Sperant #${l.id} (${l.segment ?? 'sin etapa'}, ${l.seller ?? 'sin asesor'}, alta ${fechaCorta(creado)})`, createdAt: new Date() } });
                    await notasProformas(leadActivo.id, proformas);
                }
                continue;
            }
            informe.leads.nuevos++;
            informe.proformas.notas += proformas.length;
            if (simulacion)
                continue;
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
                    attribution: attribution,
                    consent: { origen: 'sperant', email: l.emailConsent, publicidad: l.publicityConsent },
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
                    meta: { sperant_client_id: l.id },
                    createdAt: creado,
                },
            });
            await notasProformas(lead.id, proformas);
        }
        catch (err) {
            informe.leads.errores++;
            if (informe.erroresDetalle.length < 50)
                informe.erroresDetalle.push({ clientId: l.id, motivo: err instanceof Error ? err.message.split('\n')[0] : String(err) });
        }
    }
    informe.fin = new Date().toISOString();
    return informe;
}
/** Texto de la nota de una proforma de Sperant, con precios por unidad y cotitulares. */
function textoProforma(b) {
    const mon = b.currency === 'USD' ? 'US$' : 'S/';
    const unidades = (b.units ?? [])
        .map((u) => `${u.name ?? u.code}${u.sale_price != null ? ` ${mon} ${soles(u.sale_price)}` : ''}${u.discount ? ` (dto ${soles(u.discount)})` : ''}`)
        .join(', ');
    const total = soles(b.total_price);
    const conDto = b.total_price_discount != null && Number(b.total_price_discount) !== Number(b.total_price) ? ` → con descuento ${mon} ${soles(b.total_price_discount)}` : '';
    const titulares = (b.titulars ?? []);
    const cotitulares = titulares.length > 1
        ? ` · titulares: ${titulares.map((t) => `${[t.fname, t.lname].filter(Boolean).join(' ')}${t.document ? ` (doc ${t.document})` : ''}${t.percentage != null ? ` ${t.percentage}%` : ''}`).join('; ')}`
        : '';
    const tope = b.can_discount ? ` · descuento autorizado hasta ${mon} ${soles(b.can_discount)}` : '';
    return `Proforma en Sperant ${b.code ?? b.id} del ${fechaCorta(fecha(b.created_at))}: ${unidades || 'sin unidades'} · total ${mon} ${total}${conDto} · ${b.funding_type ?? ''}${b.expire_date ? ` · vence ${fechaCorta(fecha(b.expire_date))}` : ''}${tope}${cotitulares}`;
}
async function notasProformas(leadId, proformas) {
    for (const b of proformas) {
        await prisma.activity.create({
            data: {
                leadId,
                type: 'nota',
                body: textoProforma(b),
                meta: { sperant_budget_id: b.id, sperant_budget_code: b.code, sperant_budget: b },
                createdAt: fecha(b.created_at) ?? new Date(),
            },
        });
    }
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
export async function completarDatos(organizationId, simulacion) {
    const d = leerDatos(organizationId);
    if (!d)
        throw new Error('No hay datos exportados');
    const informe = {
        simulacion, leadsRevisados: 0, leadsCompletados: 0, fusionesCompletadas: 0, documentosFalsosLimpiados: 0, proformasCompletadas: 0, sinLeadEnCrm: 0,
        diagnostico: { clientesEnExport: 0, sinDetalleEnExport: 0, documentosAutoEnExport: 0, documentoAutoContactoSinDocumento: 0, documentoAutoContactoConOtro: 0, proformasEnExport: d.budgets.length, notasProformaExistentes: 0, notasProformaACrear: 0 },
    };
    const todos = unir(d);
    const porId = new Map(todos.map((l) => [l.id, l]));
    informe.diagnostico.clientesEnExport = todos.length;
    informe.diagnostico.sinDetalleEnExport = todos.filter((l) => Object.keys(l.crudo.cliente).length === 0).length;
    informe.diagnostico.documentosAutoEnExport = todos.filter((l) => l.document && !docReal(l.document)).length;
    const leadPorCliente = new Map();
    const leads = await prisma.lead.findMany({
        where: { organizationId, attribution: { path: '$.sperant', not: Prisma.AnyNull } },
        select: { id: true, attribution: true, contact: { select: { id: true, document: true } } },
    });
    const vistos = new Set();
    for (const lead of leads) {
        informe.leadsRevisados++;
        const attr = (lead.attribution ?? {});
        const cid = Number(attr.sperant?.client_id);
        const l = porId.get(cid);
        if (!l)
            continue;
        vistos.add(cid);
        leadPorCliente.set(cid, lead.id);
        for (const f of attr.sperant_fusiones ?? [])
            if (!leadPorCliente.has(Number(f)))
                leadPorCliente.set(Number(f), lead.id);
        let nueva = attr;
        if (!attr.sperant?.cliente) {
            nueva = { ...nueva, sperant: { ...attr.sperant, ...l.crudo } };
            informe.leadsCompletados++;
        }
        const faltan = (attr.sperant_fusiones ?? []).filter((f) => porId.has(Number(f)) && !attr.sperant_fusiones_datos?.[f]);
        if (faltan.length) {
            nueva = {
                ...nueva,
                sperant_fusiones_datos: { ...(attr.sperant_fusiones_datos ?? {}), ...Object.fromEntries(faltan.map((f) => [f, porId.get(Number(f)).crudo])) },
            };
            informe.fusionesCompletadas += faltan.length;
        }
        for (const f of attr.sperant_fusiones ?? [])
            vistos.add(Number(f));
        if (!simulacion && nueva !== attr) {
            await prisma.lead.update({ where: { id: lead.id }, data: { attribution: nueva } });
        }
        const falso = l.document && !docReal(l.document) ? normalizeDocument(l.document) : null;
        if (falso && lead.contact.document === falso) {
            informe.documentosFalsosLimpiados++;
            if (!simulacion)
                await prisma.contact.update({ where: { id: lead.contact.id }, data: { document: null } });
        }
        else if (falso) {
            if (lead.contact.document)
                informe.diagnostico.documentoAutoContactoConOtro++;
            else
                informe.diagnostico.documentoAutoContactoSinDocumento++;
        }
    }
    informe.sinLeadEnCrm = [...porId.keys()].filter((k) => !vistos.has(k)).length;
    // Proformas: las notas ya creadas reciben la proforma completa y los cotitulares.
    const presupuestos = new Map(d.budgets.map((b) => [String(b.id), b]));
    const notas = await prisma.activity.findMany({
        where: { lead: { organizationId }, type: 'nota', meta: { path: '$.sperant_budget_id', not: Prisma.AnyNull } },
        select: { id: true, leadId: true, meta: true },
    });
    informe.diagnostico.notasProformaExistentes = notas.length;
    const conNota = new Set(notas.map((n) => `${n.leadId}:${String(n.meta?.sperant_budget_id)}`));
    // Proformas sin nota (la importación se corrió sin proformas): se crean ahora, en el lead
    // de cada titular, con la fecha original.
    for (const b of d.budgets) {
        for (const t of b.titulars ?? []) {
            const leadId = leadPorCliente.get(Number(t.id));
            if (!leadId || conNota.has(`${leadId}:${String(b.id)}`))
                continue;
            conNota.add(`${leadId}:${String(b.id)}`);
            informe.diagnostico.notasProformaACrear++;
            if (!simulacion)
                await notasProformas(leadId, [b]);
        }
    }
    for (const n of notas) {
        const meta = (n.meta ?? {});
        if (meta.sperant_budget)
            continue;
        const b = presupuestos.get(String(meta.sperant_budget_id));
        if (!b)
            continue;
        informe.proformasCompletadas++;
        if (!simulacion) {
            await prisma.activity.update({ where: { id: n.id }, data: { body: textoProforma(b), meta: { ...meta, sperant_budget: b } } });
        }
    }
    return informe;
}
/** Arranca la importación real en segundo plano. */
export async function iniciarImportacion(organizationId, mapa) {
    if (enMarcha.has(organizationId) || tareaEnCurso(organizationId))
        throw new Error('Ya hay una tarea en curso');
    if (!hayDatos(organizationId))
        throw new Error('Primero hay que exportar');
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
export async function asesoresSperant(organizationId) {
    const d = leerDatos(organizationId);
    const usuariosSp = new Map((d?.users ?? []).map((u) => [String(u.username ?? ''), u]));
    const leads = await prisma.lead.findMany({
        where: { organizationId, attribution: { path: '$.sperant', not: Prisma.AnyNull } },
        select: { attribution: true, status: true, owner: { select: { id: true, name: true, email: true } } },
    });
    const porAsesor = new Map();
    for (const l of leads) {
        const usuario = String(l.attribution.sperant?.asesor ?? '') || '(sin asesor)';
        const fila = porAsesor.get(usuario) ?? { leads: 0, abiertos: 0, duenos: new Map() };
        fila.leads++;
        if (l.status === 'activo')
            fila.abiertos++;
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
/**
 * Reasigna los leads importados según quién los llevaba en Sperant (`attribution.sperant.asesor`),
 * creando los usuarios que hagan falta. Pisa al dueño actual a propósito: es para deshacer una
 * asignación provisional. No toca leads que no vinieron de Sperant.
 *
 * Sin aviso por correo (serían cientos); cada lead recibe su asignación en el historial y una
 * actividad «Asesor → X (según Sperant)».
 */
export async function reasignarPorAsesor(organizationId, porUserId, asignaciones) {
    const resultado = [];
    for (const a of asignaciones) {
        let userId = a.userId ?? null;
        let creado = false;
        if (!userId && a.crear) {
            const email = a.crear.email.trim().toLowerCase();
            const existe = await prisma.user.findFirst({ where: { organizationId, email } });
            if (existe) {
                userId = existe.id;
            }
            else {
                const nuevo = await prisma.user.create({ data: { organizationId, email, name: a.crear.name.trim(), role: a.crear.role, active: true } });
                await prisma.auditLog.create({ data: { organizationId, userId: porUserId, action: 'user.create', entity: 'user', entityId: nuevo.id, meta: { email, role: a.crear.role, conPassword: false, origen: 'sperant' } } });
                userId = nuevo.id;
                creado = true;
            }
        }
        if (!userId)
            continue;
        const usuario = await prisma.user.findFirst({ where: { id: userId, organizationId } });
        if (!usuario)
            throw new Error(`El usuario para ${a.username} no existe`);
        if (!usuario.active)
            throw new Error(`${usuario.email} está desactivado`);
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
                prisma.assignment.createMany({ data: ids.map((leadId) => ({ leadId, userId: userId, reason: 'sperant' })) }),
                prisma.lead.updateMany({ where: { id: { in: ids } }, data: { ownerId: userId } }),
                prisma.activity.createMany({ data: ids.map((leadId) => ({ leadId, userId: porUserId, type: 'sistema', body: `Asesor → ${usuario.name} (según Sperant: ${a.username})` })) }),
            ]);
        }
        resultado.push({ username: a.username, usuario: `${usuario.name} (${usuario.email})`, creado, leads: cambiar.length });
    }
    await prisma.auditLog.create({ data: { organizationId, userId: porUserId, action: 'sperant.reasignar', meta: resultado } });
    return resultado;
}
