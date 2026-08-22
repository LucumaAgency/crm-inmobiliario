import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import { prisma } from './db.js';
import { originAllowed } from './lib/keys.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import adminRoutes from './routes/admin.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export async function buildApp() {
    const app = Fastify({
        logger: { level: env.isProd ? 'warn' : 'info' },
        trustProxy: true, // detrás de Passenger / nginx en Plesk
        bodyLimit: 1_000_000,
    });
    await app.register(cookie);
    await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
    /**
     * CORS dinámico: la lista blanca vive en cada sitio, no en una variable de entorno.
     * Es justo lo que la API de Sperant no permitía y lo que hace posible que el navegador
     * hable directo con nosotros.
     */
    await app.register(cors, {
        credentials: true,
        // Se devuelve el valor (no se usa callback): @fastify/cors soporta promesas.
        origin: async (origin) => {
            if (!origin)
                return true; // server-to-server (el proxy del plugin)
            if (origin === env.appUrl || origin.startsWith('http://localhost'))
                return true;
            const sites = await prisma.site.findMany({
                where: { active: true },
                select: { allowedOrigins: true },
            });
            return sites.some((s) => originAllowed(origin, s.allowedOrigins));
        },
    });
    app.get('/api/health', async () => ({
        ok: true,
        version: process.env.npm_package_version ?? '0.1.0',
        node: process.version,
    }));
    // Rutas públicas (conector WP). Límite más alto: es la ruta crítica del producto.
    await app.register(async (scope) => {
        await scope.register(rateLimit, { max: 60, timeWindow: '1 minute' });
        await publicRoutes(scope);
    }, { prefix: '/api/v1/public' });
    await app.register(authRoutes, { prefix: '/api/v1/auth' });
    await app.register(leadRoutes, { prefix: '/api/v1/leads' });
    await app.register(adminRoutes, { prefix: '/api/v1' });
    // El SPA compilado se sirve desde el mismo proceso (una sola app en Plesk).
    const webDist = path.resolve(__dirname, '../../web/dist');
    if (fs.existsSync(webDist)) {
        await app.register(fastifyStatic, { root: webDist, wildcard: false });
        app.setNotFoundHandler((req, reply) => {
            if (req.url.startsWith('/api/'))
                return reply.code(404).send({ error: 'No encontrado' });
            return reply.sendFile('index.html');
        });
    }
    return app;
}
