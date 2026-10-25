/**
 * Primeros pasos: qué le falta a la organización (y a la persona) para usar el CRM.
 *
 * Cada paso se da por hecho mirando los datos, no marcando una casilla: si ya hay
 * tipologías, el paso de tipologías está hecho aunque las haya creado otro. Los pasos
 * dependen del vertical (inmobiliaria: proyecto → tipologías → unidades; agencia:
 * servicio → paquetes) y de los permisos: a un asesor no se le pide configurar canales.
 */
import type { FastifyInstance } from 'fastify';
export default function primerosPasosRoutes(app: FastifyInstance): Promise<void>;
