/**
 * Clientes activos y cobranza (vertical agencia). En la organización de Lucuma solo la cuenta de
 * Lucuma; en otra agencia, quien tenga `clientes.gestionar` (ver `puedeVerClientes`). En el CRM
 * de una inmobiliaria estas rutas no existen para nadie.
 */
import type { FastifyInstance } from 'fastify';
export default function clientesRoutes(app: FastifyInstance): Promise<void>;
