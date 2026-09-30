import { audit, loadUser } from '../lib/auth.js';
import { baseUrlDePeticion } from '../lib/tenant.js';
import { logError } from '../lib/log.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { canjearCodigo, conectarPaginas, firmarEstado, leerEstado, mensajeDeError, nuevoNonce, oauthDisponible, paginasAutorizadas, redirectUri, urlDeAutorizacion, } from '../services/meta-oauth.js';
const COOKIE_NONCE = 'lcrm_meta_oauth';
const RUTA_AJUSTES = '/ajustes?seccion=meta';
export default async function metaOAuthRoutes(app) {
    app.get('/estado', async (req, reply) => {
        await loadUser(req);
        if (!req.user)
            return reply.code(401).send({ error: 'No autenticado' });
        return { disponible: oauthDisponible(), redirectUri: redirectUri(baseUrlDePeticion(req)) };
    });
    app.get('/start', async (req, reply) => {
        await loadUser(req);
        const base = baseUrlDePeticion(req);
        if (!req.user)
            return reply.redirect(`${base}/`);
        if (req.user.role !== 'admin_lucuma' && req.user.role !== 'gerente') {
            return volver(reply, base, { meta: 'error', detalle: 'Solo un gerente puede conectar páginas.' });
        }
        if (!oauthDisponible()) {
            return volver(reply, base, {
                meta: 'error',
                detalle: 'El botón no está configurado en el servidor (META_APP_ID / META_LOGIN_CONFIG_ID).',
            });
        }
        let projectId = null;
        if (req.query.projectId) {
            const p = await prisma.project.findFirst({
                where: { id: req.query.projectId, organizationId: req.user.organizationId },
            });
            projectId = p?.id ?? null;
        }
        const nonce = nuevoNonce();
        const estado = firmarEstado({
            organizationId: req.user.organizationId,
            userId: req.user.id,
            projectId,
            volverA: base,
            nonce,
            exp: Date.now() + 10 * 60 * 1000,
        });
        reply.setCookie(COOKIE_NONCE, nonce, {
            httpOnly: true,
            sameSite: 'lax',
            secure: env.isProd,
            path: '/api/v1/meta/oauth',
            maxAge: 10 * 60,
        });
        return reply.redirect(urlDeAutorizacion(estado, redirectUri(base)));
    });
    app.get('/callback', async (req, reply) => {
        const base = baseUrlDePeticion(req);
        const nonce = req.cookies?.[COOKIE_NONCE];
        reply.clearCookie(COOKIE_NONCE, { path: '/api/v1/meta/oauth' });
        const estado = leerEstado(req.query.state, nonce);
        if (!estado) {
            return volver(reply, base, {
                meta: 'error',
                detalle: 'La conexión venció o no empezó desde este navegador. Vuelve a intentarlo.',
            });
        }
        // Aunque el estado valga, la sesión tiene que ser la misma persona de la misma
        // organización: un estado robado no abre nada si la cookie de sesión no acompaña.
        await loadUser(req);
        if (!req.user || req.user.organizationId !== estado.organizationId) {
            return volver(reply, estado.volverA, { meta: 'error', detalle: 'La sesión cambió durante la conexión.' });
        }
        if (req.query.error || !req.query.code) {
            const detalle = req.query.error_reason === 'user_denied'
                ? 'Se canceló en Facebook antes de terminar.'
                : req.query.error_description ?? 'Facebook no devolvió el código de autorización.';
            return volver(reply, estado.volverA, { meta: 'error', detalle });
        }
        try {
            const token = await canjearCodigo(req.query.code, redirectUri(estado.volverA));
            const paginas = await paginasAutorizadas(token);
            if (!paginas.length) {
                return volver(reply, estado.volverA, {
                    meta: 'error',
                    detalle: 'Facebook no entregó ninguna página. En el diálogo hay que marcar al menos una.',
                });
            }
            const r = await conectarPaginas(estado, paginas);
            await audit(estado.organizationId, estado.userId, 'meta.page.connect', {
                meta: { via: 'oauth', conectadas: r.conectadas, ajenas: r.ajenas.length },
                ip: req.ip,
            });
            return volver(reply, estado.volverA, {
                meta: 'ok',
                conectadas: r.conectadas.join('|'),
                ...(r.ajenas.length ? { ajenas: String(r.ajenas.length) } : {}),
                ...(r.sinSuscribir.length ? { sinSuscribir: r.sinSuscribir.map((s) => s.nombre).join('|') } : {}),
            });
        }
        catch (err) {
            logError('meta: fallo en el retorno de OAuth', err);
            return volver(reply, estado.volverA, { meta: 'error', detalle: mensajeDeError(err) });
        }
    });
}
function volver(reply, base, params) {
    const url = new URL(RUTA_AJUSTES, base.replace(/\/$/, '') + '/');
    for (const [k, v] of Object.entries(params))
        url.searchParams.set(k, v);
    return reply.redirect(url.toString());
}
