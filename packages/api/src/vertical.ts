/**
 * Cambia el vertical de una organización.
 *
 *   npm run vertical:prod -- <slug> <inmobiliaria|agencia>
 */
import { prisma } from './db.js';
import { esVertical } from '@lucuma-crm/shared';

const [slug, vertical] = process.argv.slice(2);
if (!slug || !vertical || !esVertical(vertical)) {
  console.error('Uso: npm run vertical:prod -- <slug> <inmobiliaria|agencia>');
  process.exit(1);
}
const org = await prisma.organization.findUnique({ where: { slug } });
if (!org) { console.error(`No existe la organización ${slug}.`); process.exit(1); }
await prisma.organization.update({ where: { id: org.id }, data: { vertical } });
console.log(`${org.name} (${slug}) ahora es vertical «${vertical}».`);
await prisma.$disconnect();
