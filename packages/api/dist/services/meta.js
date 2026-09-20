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
/**
 * Registra el aviso y encola su procesado. Idempotente: el mismo `leadgen_id` dos veces
 * deja una sola fila y encola una sola vez.
 *
 * Devuelve `false` si el aviso se ignora (página desconocida o desactivada), para que el
 * webhook lo deje anotado en el log sin fallar: a Meta se le responde 200 igual, porque
 * un error nuestro repetido le hace desactivar la suscripción.
 */
export async function registrarAviso(aviso) {
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
    }
    catch (err) {
        // P2002: ya estaba registrado. Es un reintento de Meta, no un lead nuevo.
        if (err.code === 'P2002') {
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
export async function procesarLeadgen(leadgenId) {
    const registro = await prisma.metaLead.findUnique({ where: { leadgenId } });
    if (!registro)
        throw new Error(`meta: no hay registro del leadgen ${leadgenId}`);
    if (registro.status === 'procesado')
        return; // ya entró: la cola reintentó de más
    const pagina = await prisma.metaPage.findUnique({ where: { pageId: registro.pageId } });
    if (!pagina || !pagina.active) {
        await prisma.metaLead.update({
            where: { id: registro.id },
            data: { status: 'descartado', error: 'La página ya no está conectada' },
        });
        return;
    }
    let datos;
    try {
        datos = await traerDelGraph(leadgenId, descifrar(pagina.accessTokenEnc));
    }
    catch (err) {
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
    const resultado = await captureLead({
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
    }, null, {
        organizationId: pagina.organizationId,
        projectId,
        source: 'meta_lead_ads',
        notifyEmails: Array.isArray(pagina.notifyEmails) ? pagina.notifyEmails : [],
    });
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
                raw: datos,
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
 * Comprueba que el token de la página sigue vivo y lista sus formularios instantáneos.
 *
 * Los formularios se devuelven para poder armar el `formMap` sin copiar identificadores
 * a mano desde el administrador de anuncios, que es donde se cometen las erratas que
 * luego mandan los leads al proyecto equivocado.
 */
export async function probarPagina(pageId) {
    const pagina = await prisma.metaPage.findUnique({ where: { pageId } });
    if (!pagina)
        return { ok: false, error: 'La página no está conectada' };
    try {
        const token = descifrar(pagina.accessTokenEnc);
        const info = (await llamarGraph(`${pageId}`, { fields: 'name' }, token));
        const formularios = (await llamarGraph(`${pageId}/leadgen_forms`, { fields: 'id,name,status', limit: '100' }, token));
        await prisma.metaPage.update({ where: { id: pagina.id }, data: { lastError: null } });
        return { ok: true, pageName: info.name, forms: formularios.data ?? [] };
    }
    catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        await prisma.metaPage.update({
            where: { id: pagina.id },
            data: { lastError: mensaje.slice(0, 1000) },
        });
        return { ok: false, error: mensaje };
    }
}
// ---------------------------------------------------------------------------
function traerDelGraph(leadgenId, token) {
    return llamarGraph(leadgenId, { fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,platform,field_data' }, token);
}
/**
 * Llamada al Graph API.
 *
 * El corte a los 15 segundos es deliberado: sin `signal`, `fetch` espera indefinidamente
 * y un Graph API colgado dejaría el job bloqueado con su fila tomada hasta que venza el
 * candado, diez minutos después.
 */
async function llamarGraph(ruta, params, token) {
    const url = new URL(`https://graph.facebook.com/${env.meta.graphVersion}/${ruta}`);
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v);
    url.searchParams.set('access_token', token);
    /**
     * `appsecret_proof` demuestra que la llamada sale de nuestra aplicación y no de alguien
     * que se hizo con el token. Meta lo exige si la app tiene activada esa opción, y con
     * ella activada un token robado no sirve fuera de aquí.
     */
    if (env.meta.appSecret) {
        url.searchParams.set('appsecret_proof', crypto.createHmac('sha256', env.meta.appSecret).update(token).digest('hex'));
    }
    const control = new AbortController();
    const corte = setTimeout(() => control.abort(), 15_000);
    try {
        const res = await fetch(url, { signal: control.signal });
        const cuerpo = (await res.json().catch(() => ({})));
        if (!res.ok || cuerpo.error) {
            const e = cuerpo.error;
            throw new Error(`Graph API ${res.status}: ${e?.message ?? 'sin detalle'} (código ${e?.code ?? '?'})`);
        }
        return cuerpo;
    }
    finally {
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
};
const ESTANDAR = [
    [/^first_name$/, 'fname'],
    [/^last_name$/, 'lname'],
    [/^email$/, 'email'],
    [/^phone_number$/, 'phone'],
    // Meta usa varios nombres según el país para el documento de identidad.
    [/^(dni|id_number|national_id|documento)$/, 'document'],
];
function mapear(campos) {
    const values = {};
    const extras = [];
    for (const campo of campos) {
        const valor = (campo.values ?? []).filter(Boolean).join(', ').trim();
        if (!valor)
            continue;
        const nombre = campo.name.toLowerCase();
        if (nombre === 'full_name') {
            const { fname, lname } = partirNombre(valor);
            values.fname = fname;
            if (lname)
                values.lname = lname;
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
    if (extras.length)
        values.message = extras.join('\n');
    return { values };
}
/** El formulario instantáneo manda sobre el proyecto por defecto de la página. */
function proyectoDe(pagina, metaFormId) {
    if (metaFormId && pagina.formMap && typeof pagina.formMap === 'object') {
        const mapa = pagina.formMap;
        const valor = mapa[metaFormId];
        if (typeof valor === 'string' && valor)
            return valor;
    }
    return pagina.projectId ?? null;
}
function limpiar(o) {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === 'string' && v !== ''));
}
/** Exportados para las pruebas del mapeo. */
export { mapear as _mapearCamposMeta, proyectoDe as _proyectoDe };
