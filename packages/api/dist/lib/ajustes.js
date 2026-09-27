/**
 * Preferencias de la organización, en `Organization.settings` (JSON).
 *
 * Cada clave tiene su valor por defecto aquí: una organización creada antes de que la clave
 * existiera no tiene nada guardado y tiene que comportarse de forma razonable igual.
 */
import { prisma } from '../db.js';
const POR_DEFECTO = { transcribirVoz: false };
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
