/**
 * Preferencias de la organización, en `Organization.settings` (JSON).
 *
 * Cada clave tiene su valor por defecto aquí: una organización creada antes de que la clave
 * existiera no tiene nada guardado y tiene que comportarse de forma razonable igual.
 */
import { prisma } from '../db.js';

export interface AjustesOrg {
  /**
   * Transcribir las notas de voz con OpenAI y proponer la actividad con Claude.
   * Apagado por defecto: sin cuentas externas, sin costo y sin enviar audio fuera del país.
   */
  transcribirVoz: boolean;
}

const POR_DEFECTO: AjustesOrg = { transcribirVoz: false };

export async function leerAjustes(organizationId: string): Promise<AjustesOrg> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  const guardado = (org?.settings ?? {}) as Partial<AjustesOrg>;
  return { ...POR_DEFECTO, ...guardado };
}

export async function guardarAjustes(organizationId: string, cambios: Partial<AjustesOrg>) {
  const actual = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  // Se mezcla con lo que haya: `settings` puede tener otras claves que esto no conoce.
  const settings = { ...((actual?.settings ?? {}) as object), ...cambios };
  await prisma.organization.update({ where: { id: organizationId }, data: { settings } });
  return leerAjustes(organizationId);
}
