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
  /**
   * Motivos de pérdida que se ofrecen al mover un lead a una etapa perdida. El asesor elige
   * uno o escribe otro. Son por organización porque cada inmobiliaria pierde por razones
   * distintas (precio, financiamiento, zona, compró a la competencia...).
   */
  motivosPerdida: string[];
  /**
   * Descuento máximo (%) que puede ofrecer un asesor que no tenga uno propio. Null = sin
   * tope. Lo define el gerente; se aplica en la proforma.
   */
  descuentoMaximoPct: number | null;
  /**
   * Nombres de los tres niveles de interés (1, 2, 3). Cada inmobiliaria les llama distinto
   * (frío/tibio/caliente, bajo/medio/alto, C/B/A); el número es lo que se guarda.
   */
  nivelesInteres: [string, string, string];
}

export const MOTIVOS_PERDIDA_DEFECTO = [
  'Precio fuera de su presupuesto',
  'No calificó al crédito',
  'Compró en otro proyecto',
  'Buscaba otra zona',
  'Buscaba otra tipología o metraje',
  'Dejó de responder',
  'Solo estaba consultando',
];

const POR_DEFECTO: AjustesOrg = {
  transcribirVoz: false,
  motivosPerdida: MOTIVOS_PERDIDA_DEFECTO,
  descuentoMaximoPct: null,
  nivelesInteres: ['Frío', 'Tibio', 'Caliente'],
};

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
