import { prisma } from '../db.js';

/**
 * Asignación en el momento de la captura. Un lead sin dueño es un lead perdido.
 * Fase 1: round robin entre los asesores activos de la organización.
 */
export async function pickOwner(organizationId: string): Promise<string | null> {
  const asesores = await prisma.user.findMany({
    where: { organizationId, active: true, role: 'asesor' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (asesores.length === 0) return null;

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

export async function assignLead(leadId: string, userId: string, reason = 'round_robin') {
  await prisma.$transaction([
    prisma.assignment.updateMany({
      where: { leadId, endedAt: null },
      data: { endedAt: new Date() },
    }),
    prisma.assignment.create({ data: { leadId, userId, reason } }),
    prisma.lead.update({ where: { id: leadId }, data: { ownerId: userId } }),
  ]);
}
