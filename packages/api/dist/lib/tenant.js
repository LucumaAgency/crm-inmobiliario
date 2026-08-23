import { prisma } from '../db.js';
import { env } from '../env.js';
const TTL_MS = 60_000;
const cache = new Map();
/** Deja el host sin puerto y en minúsculas. */
function limpiarHost(host) {
    return (host ?? '').split(':')[0].trim().toLowerCase();
}
/**
 * Etiqueta del subdominio, o null si el host no cuelga del dominio base.
 *
 * `bastion.crmlucuma.com` → `bastion`
 * `crmlucuma.com`         → null (es la raíz, no un cliente)
 * `www.crmlucuma.com`     → null
 * `a.b.crmlucuma.com`     → null (no se admiten niveles extra)
 */
export function slugDesdeHost(host, base) {
    const h = limpiarHost(host);
    const b = base.trim().toLowerCase().replace(/^\./, '');
    if (!h || !b)
        return null;
    if (h === b || h === `www.${b}`)
        return null;
    if (!h.endsWith(`.${b}`))
        return null;
    const etiqueta = h.slice(0, -(b.length + 1));
    if (!etiqueta || etiqueta.includes('.'))
        return null;
    if (etiqueta === 'www')
        return null;
    return etiqueta;
}
/** Busca la organización del subdominio, con caché corta. */
export async function resolverTenant(host) {
    if (!env.baseDomain)
        return null;
    const slug = slugDesdeHost(host, env.baseDomain);
    if (!slug)
        return null;
    const ahora = Date.now();
    const enCache = cache.get(slug);
    if (enCache && enCache.expira > ahora)
        return enCache.valor;
    const org = await prisma.organization.findUnique({
        where: { slug },
        select: { id: true, name: true, slug: true },
    });
    cache.set(slug, { valor: org, expira: ahora + TTL_MS });
    return org;
}
/** Olvida la caché de un slug. Para cuando se crea o renombra una organización. */
export function olvidarTenant(slug) {
    if (slug)
        cache.delete(slug);
    else
        cache.clear();
}
/**
 * ¿La sesión pertenece al cliente de este subdominio?
 *
 * Es lo que impide que la cookie emitida en `bastion.` sirva en `proba.` si alguien la
 * copia a mano. Sin dominio base configurado (un solo cliente) siempre es válida.
 */
export function sesionCoincide(req, organizationId) {
    if (!req.tenant)
        return true;
    return req.tenant.id === organizationId;
}
/**
 * URL base a la que debe volver el usuario, según desde dónde pidió.
 *
 * En modo de un solo cliente es `APP_URL`. Con varios, se reconstruye desde el host de la
 * petición: un enlace de acceso pedido en `bastion.` tiene que volver a `bastion.`, nunca
 * a la raíz ni al subdominio de otro cliente.
 */
export function baseUrlDePeticion(req) {
    if (!env.baseDomain || !req.tenant)
        return env.appUrl.replace(/\/$/, '');
    const host = limpiarHost(req.headers.host);
    const protocolo = req.protocol === 'http' && env.isProd ? 'https' : req.protocol;
    return `${protocolo}://${host}`;
}
/** URL del CRM de una organización, para los correos que envía el worker. */
export function urlDeOrganizacion(slug) {
    if (!env.baseDomain || !slug)
        return env.appUrl.replace(/\/$/, '');
    return `https://${slug}.${env.baseDomain}`;
}
