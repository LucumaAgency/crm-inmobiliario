import { prisma } from '../db.js';
/**
 * Comprueba que las tipologías y unidades existen y pertenecen al proyecto del lead.
 *
 * Es la misma defensa que tiene la reasignación: sin ella, un id de otra organización
 * pasaría por el cuerpo de la petición y quedaría colgado de un lead ajeno. Devuelve los
 * registros ya cargados para no repetir la consulta al escribir la actividad.
 */
export async function validarIntereses(projectId, input) {
    const typologyIds = [...new Set(input.typologyIds ?? [])];
    const unitIds = [...new Set(input.unitIds ?? [])];
    if ((typologyIds.length || unitIds.length) && !projectId) {
        throw new Error('Para marcar tipologías o unidades el lead necesita un proyecto');
    }
    const [tipologias, unidades] = await Promise.all([
        typologyIds.length
            ? prisma.typology.findMany({ where: { id: { in: typologyIds }, projectId: projectId } })
            : Promise.resolve([]),
        unitIds.length
            ? prisma.unit.findMany({ where: { id: { in: unitIds }, projectId: projectId } })
            : Promise.resolve([]),
    ]);
    if (tipologias.length !== typologyIds.length)
        throw new Error('Alguna tipología no pertenece al proyecto');
    if (unidades.length !== unitIds.length)
        throw new Error('Alguna unidad no pertenece al proyecto');
    return { tipologias, unidades };
}
/** Reemplaza el conjunto completo de intereses del lead (lo que el asesor dejó marcado). */
export async function reemplazarIntereses(tx, leadId, input) {
    await tx.leadTypologyInterest.deleteMany({ where: { leadId, typologyId: { notIn: input.typologyIds } } });
    await tx.leadUnitInterest.deleteMany({ where: { leadId, unitId: { notIn: input.unitIds } } });
    await sumarIntereses(tx, leadId, input);
}
/** Suma sin quitar: lo usa la captura, que nunca debe borrar lo que el asesor marcó. */
export async function sumarIntereses(tx, leadId, input) {
    if (input.typologyIds?.length) {
        await tx.leadTypologyInterest.createMany({
            data: input.typologyIds.map((typologyId) => ({ leadId, typologyId })),
            skipDuplicates: true,
        });
    }
    if (input.unitIds?.length) {
        await tx.leadUnitInterest.createMany({
            data: input.unitIds.map((unitId) => ({ leadId, unitId })),
            skipDuplicates: true,
        });
    }
}
/** Al cambiar de proyecto, los intereses del anterior ya no aplican. */
export async function vaciarIntereses(tx, leadId) {
    await tx.leadTypologyInterest.deleteMany({ where: { leadId } });
    await tx.leadUnitInterest.deleteMany({ where: { leadId } });
}
export const includeIntereses = {
    typologyInterests: {
        include: { typology: { select: { id: true, name: true, bedrooms: true, areaM2: true, priceFrom: true, currency: true } } },
        orderBy: { createdAt: 'asc' },
    },
    unitInterests: {
        include: {
            unit: { select: { id: true, code: true, status: true, bedrooms: true, areaM2: true, price: true, currency: true, typologyRef: { select: { id: true, name: true } } } },
        },
        orderBy: { createdAt: 'asc' },
    },
};
