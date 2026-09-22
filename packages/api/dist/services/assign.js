import { prisma } from '../db.js';
/**
 * Asignación en el momento de la captura. Un lead sin dueño es un lead perdido.
 * Fase 1: round robin entre los asesores activos de la organización.
 */
export async function pickOwner(organizationId) {
    const asesores = await prisma.user.findMany({
        where: { organizationId, active: true, role: 'asesor' },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
    });
    if (asesores.length === 0)
        return null;
    // Round robin real: el que hace más tiempo que no recibe un lead.
    const ultimos = await prisma.assignment.groupBy({
        by: ['userId'],
        where: { userId: { in: asesores.map((a) => a.id) } },
        _max: { assignedAt: true },
    });
    const mapa = new Map(ultimos.map((u) => [u.userId, u._max.assignedAt?.getTime() ?? 0]));
    asesores.sort((a, b) => (mapa.get(a.id) ?? 0) - (mapa.get(b.id) ?? 0));
    return asesores[0].id;
}
/**
 * Asigna un lead a un asesor.
 *
 * La comprobación de que ambos son del mismo cliente va AQUÍ y no en la ruta, porque esta
 * función la llaman la captura, el round robin y la reasignación manual: en el borde se
 * olvida en alguna. Y lo que estaba en juego no era solo un dato descuadrado: el aviso de
 * lead nuevo se manda al correo del dueño, así que un `ownerId` de otra organización
 * recibía el nombre y el teléfono de una persona que no es suya (Ley 29733).
 */
export async function assignLead(leadId, userId, reason = 'round_robin') {
    const [lead, usuario] = await Promise.all([
        prisma.lead.findUnique({ where: { id: leadId }, select: { organizationId: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { organizationId: true, active: true } }),
    ]);
    if (!lead)
        throw new Error(`assignLead: no existe el lead ${leadId}`);
    if (!usuario || usuario.organizationId !== lead.organizationId) {
        throw Object.assign(new Error('El asesor no pertenece a esta organización'), { statusCode: 400 });
    }
    if (!usuario.active) {
        throw Object.assign(new Error('Ese asesor está desactivado'), { statusCode: 400 });
    }
    await prisma.$transaction([
        prisma.assignment.updateMany({
            where: { leadId, endedAt: null },
            data: { endedAt: new Date() },
        }),
        prisma.assignment.create({ data: { leadId, userId, reason } }),
        prisma.lead.update({ where: { id: leadId }, data: { ownerId: userId } }),
    ]);
}
