import type { FastifyInstance } from 'fastify';
declare module 'fastify' {
    interface FastifyRequest {
        /** Cuerpo sin parsear. Solo lo rellena este plugin: la firma se calcula sobre él. */
        rawBody?: string;
    }
}
export default function metaRoutes(app: FastifyInstance): Promise<void>;
