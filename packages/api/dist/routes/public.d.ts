import type { FastifyInstance } from 'fastify';
/**
 * API pública que consume el conector de WordPress.
 *
 * Dos llaves:
 *  - public key (cabecera X-LCRM-Key): leer el esquema y enviar submissions, solo desde
 *    los dominios autorizados del sitio.
 *  - secret key (cabecera X-LCRM-Secret): listar formularios y leer catálogos, server side.
 */
export default function publicRoutes(app: FastifyInstance): Promise<void>;
