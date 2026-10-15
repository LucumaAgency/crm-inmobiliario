/**
 * Migración desde Sperant, desde Ajustes → Migración Sperant.
 *
 * Todo bajo `canales.configurar` o `usuarios.gestionar`: es una operación de gerencia. El
 * token nunca sale por la API (solo su pista). Lógica en `services/sperant.ts`.
 */
import type { FastifyInstance } from 'fastify';
export default function sperantRoutes(app: FastifyInstance): Promise<void>;
