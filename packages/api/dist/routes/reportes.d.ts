import type { FastifyInstance } from 'fastify';
/**
 * Resumen y reportes. Todo sale de UNA consulta de los leads de los dos períodos y se agrega
 * aquí: con el volumen de una inmobiliaria (cientos al mes) es más simple y más barato que
 * una consulta agrupada por cada tarjeta.
 *
 * Respeta la visibilidad del rol: el asesor ve sus números, no los del equipo.
 */
export default function reportesRoutes(app: FastifyInstance): Promise<void>;
