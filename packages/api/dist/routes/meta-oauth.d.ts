/**
 * Rutas del botón «Conectar con Facebook».
 *
 *  - `GET /api/v1/meta/oauth/estado`   — ¿está configurado? Lo lee la pantalla de Ajustes.
 *  - `GET /api/v1/meta/oauth/start`    — exige sesión de gestión; firma el `state`, deja el
 *                                        nonce en una cookie y manda al diálogo de Meta.
 *  - `GET /api/v1/meta/oauth/callback` — vuelve de Meta. Es una navegación del navegador,
 *                                        no una llamada de la SPA: el resultado se
 *                                        devuelve como redirección a Ajustes con el
 *                                        detalle en la URL, nunca como JSON.
 *
 * Van en su propio plugin y no en `admin.ts` porque el callback no puede responder 401
 * en JSON: la persona está mirando una pestaña del navegador, no una petición fetch.
 */
import type { FastifyInstance } from 'fastify';
export default function metaOAuthRoutes(app: FastifyInstance): Promise<void>;
