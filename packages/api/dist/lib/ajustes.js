/**
 * Preferencias de la organización, en `Organization.settings` (JSON).
 *
 * Cada clave tiene su valor por defecto aquí: una organización creada antes de que la clave
 * existiera no tiene nada guardado y tiene que comportarse de forma razonable igual.
 */
import { prisma } from '../db.js';
export const PROFORMA_NOTA_DEFECTO = 'La presente proforma tiene una validez de tres (03) días calendario desde la fecha de su emisión, no pudiendo el cliente efectuar reclamo alguno fuera del tiempo previamente estipulado, estando los precios de venta sujetos a variación sin previo aviso.';
export const MOTIVOS_PERDIDA_DEFECTO = [
    'Precio fuera de su presupuesto',
    'No calificó al crédito',
    'Compró en otro proyecto',
    'Buscaba otra zona',
    'Buscaba otra tipología o metraje',
    'Dejó de responder',
    'Solo estaba consultando',
];
const POR_DEFECTO = {
    transcribirVoz: false,
    motivosPerdida: MOTIVOS_PERDIDA_DEFECTO,
    descuentoMaximoPct: null,
    nivelesInteres: ['Frío', 'Tibio', 'Caliente'],
    proformaValidezDias: 3,
    proformaNota: PROFORMA_NOTA_DEFECTO,
};
export async function leerAjustes(organizationId) {
    const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
    });
    const guardado = (org?.settings ?? {});
    return { ...POR_DEFECTO, ...guardado };
}
export async function guardarAjustes(organizationId, cambios) {
    const actual = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { settings: true },
    });
    // Se mezcla con lo que haya: `settings` puede tener otras claves que esto no conoce.
    const settings = { ...(actual?.settings ?? {}), ...cambios };
    await prisma.organization.update({ where: { id: organizationId }, data: { settings } });
    return leerAjustes(organizationId);
}
