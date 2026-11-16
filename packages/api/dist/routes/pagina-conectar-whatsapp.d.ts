/**
 * Página puente del botón «Conectar WhatsApp», en `APP_URL/conectar-whatsapp`.
 *
 * HTML suelto a propósito, sin el SPA: tiene que abrir sin sesión (el dominio base no
 * tiene la cookie del cliente) y lo único que hace es cargar el SDK de Facebook, abrir el
 * registro de Meta y mandar el código al servidor. El pase llega en el fragmento
 * (`#pase=`) y se borra de la barra de direcciones apenas se lee.
 *
 * Detalles de Meta que este archivo respeta (docs de Embedded Signup, nov-2026):
 *  - El callback de `FB.login` NO puede ser `async`: el SDK lo rechaza.
 *  - El código vive 30 s: se manda al servidor en cuanto llega.
 *  - En coexistencia el evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` trae solo
 *    `waba_id`; el servidor resuelve el número.
 *  - La versión del flujo la fija la configuración (producto elegido ⇒ v4): no se manda
 *    `extras.version`.
 */
import type { FastifyInstance } from 'fastify';
export default function paginaConectarWhatsApp(app: FastifyInstance): Promise<void>;
