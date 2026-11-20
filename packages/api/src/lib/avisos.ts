import { ORG_LUCUMA, esCuentaLucuma } from '@lucuma-crm/shared';
import { prisma } from '../db.js';

/**
 * Correos de «Avisar a» por defecto: el de quien conecta la página o crea el formulario.
 *
 * Sin esto, un cliente que conecta su página sin llenar el campo y sin asesores con rol
 * `asesor` (el reparto solo elige entre ellos) recibía leads sin aviso a nadie.
 *
 * Excepción: una cuenta de Lucuma que configura el CRM de un cliente no se pone a sí misma.
 * Los avisos llevan nombre y teléfono del interesado, y esos datos son del cliente
 * (Ley 29733), igual que la regla de la cobranza en services/clientes.ts.
 */
export async function correosAvisoPorDefecto(userId: string): Promise<string[]> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, active: true, organization: { select: { slug: true } } },
  });
  if (!u?.active || !u.email) return [];
  if (esCuentaLucuma(u.email) && u.organization?.slug !== ORG_LUCUMA) return [];
  return [u.email];
}

/** `notifyEmails` vacío o nulo (columna JSON). */
export function sinCorreos(valor: unknown): boolean {
  return !Array.isArray(valor) || valor.length === 0;
}
