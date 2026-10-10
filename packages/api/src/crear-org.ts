/**
 * Crea una organización nueva con sus etapas por defecto y su primer administrador.
 *
 *   npm run org:prod -- <slug> "<Nombre>" <correo-admin> [contraseña] [--vertical agencia]
 *   npm run org:prod -- lucuma "Lucuma Agency" dev@lucumaagency.com MiClave123
 *
 * El slug es el subdominio (`lucuma.<CRM_BASE_DOMAIN>`): minúsculas, números y guiones.
 * Sin contraseña genera una y la imprime una sola vez. Si el correo ya existe en otra
 * organización, se crea igual en la nueva (un correo puede estar en varias; al entrar elige).
 *
 * Existe porque el seed solo sabe crear «bastion» con datos de demo, y dar de alta un
 * cliente real no puede depender de editar un archivo.
 */
import { prisma } from './db.js';
import { generarPassword, hashPassword } from './lib/password.js';
import { esVertical } from '@lucuma-crm/shared';

const ETAPAS = [
  { slug: 'por-contactar', name: 'Por contactar', position: 1, color: '#94a3b8' },
  { slug: 'contactado', name: 'Contactado', position: 2, color: '#3b82f6' },
  { slug: 'reunion-agendada', name: 'Reunión agendada', position: 3, color: '#8b5cf6' },
  { slug: 'cotizado', name: 'Cotizado', position: 4, color: '#f59e0b' },
  { slug: 'negociacion', name: 'Negociación', position: 5, color: '#10b981' },
  { slug: 'ganado', name: 'Ganado', position: 6, color: '#059669', isWon: true },
  { slug: 'perdido', name: 'Perdido', position: 7, color: '#ef4444', isLost: true },
];

async function main() {
  const args = process.argv.slice(2);
  const iv = args.indexOf('--vertical');
  const vertical = iv >= 0 ? args.splice(iv, 2)[1] : 'inmobiliaria';
  const [slug, nombre, correo, dada] = args;
  if (!esVertical(vertical ?? '')) { console.error('--vertical debe ser inmobiliaria o agencia'); process.exit(1); }
  if (!slug || !nombre || !correo) {
    console.error('Uso: npm run org:prod -- <slug> "<Nombre>" <correo-admin> [contraseña]');
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug) || ['www', 'crm', 'api', 'admin'].includes(slug)) {
    console.error('Slug inválido: minúsculas, números y guiones, y no puede ser www/crm/api/admin.');
    process.exit(1);
  }
  if (await prisma.organization.findUnique({ where: { slug } })) {
    console.error(`Ya existe una organización con slug ${slug}.`);
    process.exit(1);
  }

  const password = dada || generarPassword();
  const org = await prisma.organization.create({ data: { name: nombre, slug, vertical } });
  for (const e of ETAPAS) await prisma.stage.create({ data: { ...e, organizationId: org.id } });
  const admin = await prisma.user.create({
    data: {
      organizationId: org.id,
      email: correo.toLowerCase(),
      name: 'Administrador',
      role: 'admin_lucuma',
      active: true,
      passwordHash: await hashPassword(password),
      passwordChangedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: { organizationId: org.id, action: 'org.create', entity: 'organization', entityId: org.id, meta: { slug, via: 'cli', admin: admin.email } },
  });

  console.log(`Organización «${nombre}» creada (slug ${slug}) con ${ETAPAS.length} etapas.`);
  console.log(`Admin: ${admin.email}${dada ? '' : `\nContraseña: ${password}`}`);
  console.log(`Entra por https://${slug}.<CRM_BASE_DOMAIN> (o por el dominio único si no hay base configurada).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
