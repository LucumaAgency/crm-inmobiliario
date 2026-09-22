/**
 * Define la contraseña de un usuario desde el servidor, sin pasar por el correo.
 *
 * Es la puerta de emergencia: sirve para el primer admin y para cuando el SMTP se cae.
 * Solo la tiene quien tiene acceso al servidor.
 *
 *   npm run password:prod -- correo@dominio.com [contraseña] [slug-organizacion]
 *
 * Sin contraseña genera una aleatoria y la imprime una sola vez. El slug solo hace falta
 * si el mismo correo existe en varias organizaciones.
 */
import { PASSWORD_MIN } from '@lucuma-crm/shared';
import { prisma } from './db.js';
import { generarPassword, hashPassword } from './lib/password.js';

async function main() {
  const [correo, dada, slug] = process.argv.slice(2);
  if (!correo) {
    console.error('Uso: npm run password:prod -- correo@dominio.com [contraseña] [slug-organizacion]');
    process.exit(1);
  }
  if (dada && dada.length < PASSWORD_MIN) {
    console.error(`La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`);
    process.exit(1);
  }

  const usuarios = await prisma.user.findMany({
    where: { email: correo.toLowerCase(), ...(slug ? { organization: { slug } } : {}) },
    include: { organization: { select: { slug: true } } },
  });
  if (usuarios.length === 0) {
    console.error(`No existe ${correo}${slug ? ` en ${slug}` : ''}.`);
    process.exit(1);
  }
  if (usuarios.length > 1) {
    const orgs = usuarios.map((u) => u.organization.slug).join(', ');
    console.error(`${correo} existe en varias organizaciones (${orgs}). Indica el slug como tercer argumento.`);
    process.exit(1);
  }

  const user = usuarios[0]!;
  const password = dada || generarPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: user.organizationId,
      action: 'user.password',
      entity: 'user',
      entityId: user.id,
      meta: { via: 'cli' },
    },
  });

  console.log(`Contraseña definida para ${user.email} (${user.organization.slug}, ${user.role}).`);
  if (!user.active) console.log('OJO: el usuario está INACTIVO y no podrá entrar hasta reactivarlo.');
  if (!dada) console.log(`Contraseña: ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
