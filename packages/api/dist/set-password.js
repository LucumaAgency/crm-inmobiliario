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
 *
 *   npm run admin:prod -- correo@dominio.com contraseña [slug-organizacion]
 *
 * Igual, pero si el correo no existe lo CREA como admin_lucuma, y si existe lo deja activo
 * y con ese rol. Es un comando aparte a propósito: una errata en el correo del primero no
 * debe fabricar un admin nuevo.
 */
import { PASSWORD_MIN } from '@lucuma-crm/shared';
import { prisma } from './db.js';
import { generarPassword, hashPassword } from './lib/password.js';
async function main() {
    const args = process.argv.slice(2);
    const comoAdmin = args.includes('--admin');
    const [correo, dada, slug] = args.filter((a) => a !== '--admin');
    if (comoAdmin && !dada) {
        console.error('Uso: npm run admin:prod -- correo@dominio.com contraseña [slug-organizacion]');
        process.exit(1);
    }
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
    if (usuarios.length === 0 && comoAdmin) {
        usuarios.push(await crearAdmin(correo.toLowerCase(), slug));
    }
    if (usuarios.length === 0) {
        console.error(`No existe ${correo}${slug ? ` en ${slug}` : ''}.`);
        process.exit(1);
    }
    if (usuarios.length > 1) {
        const orgs = usuarios.map((u) => u.organization.slug).join(', ');
        console.error(`${correo} existe en varias organizaciones (${orgs}). Indica el slug como tercer argumento.`);
        process.exit(1);
    }
    const user = usuarios[0];
    const password = dada || generarPassword();
    await prisma.user.update({
        where: { id: user.id },
        data: {
            passwordHash: await hashPassword(password),
            passwordChangedAt: new Date(),
            ...(comoAdmin ? { role: 'admin_lucuma', active: true } : {}),
        },
    });
    if (comoAdmin)
        Object.assign(user, { role: 'admin_lucuma', active: true });
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
    if (!user.active)
        console.log('OJO: el usuario está INACTIVO y no podrá entrar hasta reactivarlo.');
    if (!dada)
        console.log(`Contraseña: ${password}`);
}
/** El admin nuevo va a la organización del slug, o a la única que haya. */
async function crearAdmin(email, slug) {
    const orgs = await prisma.organization.findMany({
        where: slug ? { slug } : {},
        select: { id: true, slug: true },
    });
    if (orgs.length !== 1) {
        const hay = (await prisma.organization.findMany({ select: { slug: true } })).map((o) => o.slug);
        console.error(slug
            ? `No existe la organización ${slug}. Hay: ${hay.join(', ')}.`
            : `Hay varias organizaciones (${hay.join(', ')}). Indica el slug como tercer argumento.`);
        process.exit(1);
    }
    const org = orgs[0];
    const user = await prisma.user.create({
        data: { organizationId: org.id, email, name: email.split('@')[0], role: 'admin_lucuma' },
    });
    console.log(`Usuario creado: ${email} en ${org.slug}.`);
    return { ...user, organization: { slug: org.slug } };
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
