/**
 * Borra una organización recién creada por error (p. ej. sin `--vertical`).
 *
 *   npm run org:borrar:prod -- <slug>
 *
 * Solo borra si NO tiene leads: es para deshacer un alta, no para dar de baja a un cliente
 * (eso exige respaldo y decisión, docs/26-RESPALDOS.md). Todo lo de la organización (etapas,
 * usuarios, proyectos, ajustes) se va en cascada.
 */
import { prisma } from './db.js';
async function main() {
    const [slug] = process.argv.slice(2);
    if (!slug) {
        console.error('Uso: npm run org:borrar:prod -- <slug>');
        process.exit(1);
    }
    const org = await prisma.organization.findUnique({
        where: { slug },
        include: { _count: { select: { leads: true, users: true } } },
    });
    if (!org) {
        console.error(`No existe la organización ${slug}.`);
        process.exit(1);
    }
    if (org._count.leads > 0) {
        console.error(`«${org.name}» tiene ${org._count.leads} leads: no se borra.`);
        process.exit(1);
    }
    await prisma.organization.delete({ where: { id: org.id } });
    console.log(`Organización «${org.name}» (${slug}) borrada, con sus ${org._count.users} usuario(s).`);
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
