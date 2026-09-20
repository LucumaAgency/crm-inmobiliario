import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { env } from './env.js';
import { prisma } from './db.js';
import { originAllowed } from './lib/keys.js';
import { getLogStream, logFile } from './lib/log.js';
import { resolverTenant } from './lib/tenant.js';
import { MAX_BYTES, MEDIA_PREFIX, uploadsDir } from './lib/media.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import leadRoutes from './routes/leads.js';
import adminRoutes from './routes/admin.js';
import metaRoutes from './routes/meta.js';
import cronRoutes from './routes/cron.js';
import logRoutes from './routes/logs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function buildApp() {
  // Passenger se queda con stdout y lo entierra en un log del servidor difícil de
  // encontrar, así que además se escribe a `logs/app.log`, que se abre desde el
  // Administrador de archivos de Plesk como el debug.log de WordPress.
  const logStream = getLogStream();

  const app = Fastify({
    logger: {
      level: env.isProd ? 'info' : 'debug',
      ...(logStream ? { stream: logStream } : {}),
    },
    trustProxy: true, // detrás de Passenger / nginx en Plesk
    bodyLimit: 1_000_000,
  });

  /**
   * Manejador de errores.
   *
   * Sin esto, un choque contra un índice único llegaba al navegador como un 500 con la
   * invocación de Prisma, el nombre de la tabla y el del índice: incomprensible para
   * quien lo usa y de paso una filtración de la forma interna de la base. Los errores
   * previstos se traducen; el resto se registra entero y sale genérico.
   */
  app.setErrorHandler((err, req, reply) => {
    const codigo = (err as { code?: string }).code;

    if (codigo === 'P2002') {
      return reply.code(409).send({ error: 'Ya existe un registro con ese valor.' });
    }
    if (codigo === 'P2025') {
      return reply.code(404).send({ error: 'No encontrado.' });
    }
    if (err.validation || err.statusCode === 400) {
      return reply.code(400).send({ error: 'Datos inválidos.' });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.message });
    }

    req.log.error({ err }, 'Error no controlado');
    return reply.code(500).send({ error: 'Error interno.' });
  });

  /**
   * Cada petición sabe a qué cliente pertenece, deducido del subdominio.
   * En modo de un solo cliente queda en null y todo se comporta como antes.
   */
  app.addHook('onRequest', async (req) => {
    req.tenant = await resolverTenant(req.headers.host);
  });

  await app.register(multipart, { limits: { fileSize: MAX_BYTES, files: 1 } });
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
      if (!origin) return true; // server-to-server (el proxy del plugin)
      if (origin === env.appUrl || origin.startsWith('http://localhost')) return true;
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
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 60, timeWindow: '1 minute' });
      await publicRoutes(scope);
    },
    { prefix: '/api/v1/public' }
  );

  /**
   * Webhook de Meta Lead Ads. Va por su propio ámbito porque registra un parser de JSON
   * que conserva el cuerpo crudo para comprobar la firma, y eso no debe alcanzar al resto
   * de la API. Límite propio: Meta puede mandar ráfagas cuando reintenta lo atrasado, y
   * ese tráfico no debe consumir el cupo de los formularios de los clientes.
   */
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 600, timeWindow: '1 minute' });
      await metaRoutes(scope);
    },
    { prefix: '/api/v1/meta' }
  );

  /**
   * Latido de la cola, llamado por un cron externo. Límite propio y holgado: es una ruta
   * sin sesión, y su tráfico legítimo es una llamada por minuto.
   */
  await app.register(
    async (scope) => {
      await scope.register(rateLimit, { max: 30, timeWindow: '1 minute' });
      await cronRoutes(scope);
    },
    // Silencioso por el mismo motivo: un latido por minuto son casi 3.000 líneas diarias
    // de ruido. La ruta ya escribe por su cuenta, pero solo cuando hubo trabajo.
    { prefix: '/api/v1/cron', logLevel: 'silent' }
  );

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(leadRoutes, { prefix: '/api/v1/leads' });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  /**
   * `logLevel: 'silent'`: el visor se refresca solo cada pocos segundos y cada refresco
   * escribiría dos líneas —«incoming request» y «request completed»— en el mismo archivo
   * que está mostrando. En minutos ahoga lo que se estaba buscando. Un visor de logs que
   * ensucia el log que vigila no sirve para vigilarlo.
   */
  await app.register(logRoutes, { prefix: '/api/v1/logs', logLevel: 'silent' });

  /**
   * Archivos subidos (planos y renders).
   *
   * Se sirven desde `uploads/`, que vive FUERA de `public/`: ese directorio se borra en
   * cada build y llega versionado en cada despliegue, así que un archivo subido ahí no
   * sobreviviría al siguiente deploy.
   *
   * `decorateReply: false` porque `sendFile` ya lo aporta el registro del SPA.
   */
  await fs.promises.mkdir(uploadsDir, { recursive: true }).catch(() => undefined);
  await app.register(fastifyStatic, {
    root: uploadsDir,
    prefix: `${MEDIA_PREFIX}/`,
    decorateReply: false,
    index: false,
    // Nombre por hash del contenido: si cambia el archivo, cambia la URL.
    maxAge: '365d',
    immutable: true,
  });

  // El SPA compilado (public/ en la raíz) se sirve desde el mismo proceso.
  // En Plesk ese directorio es además el document root, así que nginx entrega los
  // estáticos directo y aquí solo cae el fallback de las rutas del SPA.
  const webDist = path.resolve(__dirname, '../../../public');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });

    /**
     * Política de privacidad, sin la extensión en la URL.
     *
     * Sin esta ruta, `/privacidad` cae en el fallback del SPA y devuelve la aplicación:
     * Meta vería un HTML con un `<div id="root">` vacío en vez de la política, y el
     * cliente que pulse el enlace del diálogo de permisos, lo mismo. Es una página
     * estática a propósito: tiene que abrir sin sesión y sin JavaScript.
     */
    app.get('/privacidad', (_req, reply) => reply.sendFile('privacidad.html'));

    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'No encontrado' });
      /**
       * Un archivo que falta debe dar 404, no el HTML del SPA.
       *
       * Sin esto, `/media/loquesea.pdf` devolvía `index.html` con un 200: un `<img>` recibía
       * HTML en vez de una imagen y el fallo quedaba enmascarado, que es lo peor que puede
       * hacer un error.
       */
      if (req.url.startsWith(`${MEDIA_PREFIX}/`)) {
        return reply.code(404).send({ error: 'Archivo no encontrado' });
      }
      return reply.sendFile('index.html');
    });
  }

  app.log.info({ logFile }, 'Log de la aplicación');

  return app;
}
