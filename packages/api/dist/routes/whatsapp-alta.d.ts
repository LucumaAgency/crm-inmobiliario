/**
 * Rutas del botón «Conectar WhatsApp» (alta incrustada). Ver `services/whatsapp-alta.ts`.
 *
 * Con sesión, en el subdominio del cliente:
 *  - `GET  /api/v1/whatsapp/alta/estado` — ¿está configurado el botón?
 *  - `POST /api/v1/whatsapp/alta/pase`   — emite el pase y devuelve la URL de la página
 *                                          puente en el dominio base.
 *
 * Sin sesión, desde la página puente (el pase es la credencial):
 *  - `POST /api/v1/whatsapp/alta/info`      — organización y modo, para mostrarlos.
 *  - `POST /api/v1/whatsapp/alta/completar` — código de Meta + datos del evento.
 *  - `POST /api/v1/whatsapp/alta/evento`    — alta cancelada o con error en Meta (registro).
 *
 * El pase va siempre en el CUERPO, nunca en la URL: así no queda en logs de acceso.
 */
import type { FastifyInstance } from 'fastify';
export default function whatsappAltaRoutes(app: FastifyInstance): Promise<void>;
