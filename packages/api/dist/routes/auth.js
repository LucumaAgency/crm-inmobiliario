import { createHash, randomBytes } from 'node:crypto';
import { cambiarPasswordInput, loginInput, magicLinkInput } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { baseUrlDePeticion } from '../lib/tenant.js';
import { audit, clearSession, issueSession, loadUser, requireAuth, } from '../lib/auth.js';
import { hashDeRelleno, hashPassword, verifyPassword } from '../lib/password.js';
import { magicLinkEmail, sendMail } from '../lib/mail.js';
const VIGENCIA_MIN = 20;
/**
 * Freno a la fuerza bruta: 5 fallos por correo e IP cada 15 minutos.
 *
 * En memoria a propósito: basta para cortar un diccionario y no exige tabla ni Redis. Si
 * Passenger levanta varios procesos, cada uno cuenta por su lado, así que el límite real
 * es algo más alto; sigue siendo órdenes de magnitud menos que sin freno.
 */
const MAX_FALLOS = 5;
const VENTANA_MS = 15 * 60 * 1000;
const fallos = new Map();
function bloqueado(clave) {
    const f = fallos.get(clave);
    if (!f)
        return false;
    if (Date.now() - f.desde > VENTANA_MS) {
        fallos.delete(clave);
        return false;
    }
    return f.n >= MAX_FALLOS;
}
function anotarFallo(clave) {
    const f = fallos.get(clave);
    if (!f || Date.now() - f.desde > VENTANA_MS)
        fallos.set(clave, { n: 1, desde: Date.now() });
    else
        f.n++;
}
async function abrirSesion(req, reply, user, metodo) {
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const sesion = {
        id: user.id,
        organizationId: user.organizationId,
        role: user.role,
        email: user.email,
        name: user.name,
    };
    issueSession(reply, sesion);
    await audit(sesion.organizationId, sesion.id, 'user.login', { ip: req.ip, meta: { metodo } });
    return sesion;
}
export default async function authRoutes(app) {
    /** Pide un magic link. Responde igual exista o no el correo, para no filtrar usuarios. */
    app.post('/magic-link', async (req, reply) => {
        const parsed = magicLinkInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Correo inválido' });
        /**
         * Acotado a la organización del subdominio.
         *
         * El índice único de `User` es `(organizationId, email)`, así que el mismo correo
         * puede existir en varias organizaciones —cosa segura en cuanto Lucuma administre a
         * dos clientes—. Sin este filtro, `findFirst` devolvía una cualquiera de ellas y se
         * entraba al CRM de un cliente al azar, sin forma de elegir.
         */
        const user = await prisma.user.findFirst({
            where: {
                email: parsed.data.email.toLowerCase(),
                active: true,
                ...(req.tenant ? { organizationId: req.tenant.id } : {}),
            },
        });
        if (user) {
            const token = randomBytes(32).toString('base64url');
            await prisma.loginToken.create({
                data: {
                    userId: user.id,
                    tokenHash: createHash('sha256').update(token).digest('hex'),
                    expiresAt: new Date(Date.now() + VIGENCIA_MIN * 60 * 1000),
                },
            });
            // Con varios clientes, el enlace debe volver al subdominio desde el que se pidió:
            // uno de Bastión no puede llevar al CRM de otro, ni a la raíz.
            const url = `${baseUrlDePeticion(req)}/auth/callback?token=${token}`;
            const mail = magicLinkEmail(url, user.name);
            await sendMail({ to: user.email, ...mail });
        }
        return { ok: true, message: 'Si el correo existe, te llegará un enlace de acceso.' };
    });
    /**
     * Quién es el cliente de este subdominio. Lo consulta la pantalla de acceso para
     * mostrar su nombre; devuelve null en modo de un solo cliente.
     */
    app.get('/tenant', async (req) => ({
        tenant: req.tenant ? { name: req.tenant.name, slug: req.tenant.slug } : null,
    }));
    /** Canjea el token del enlace por una sesión. */
    app.post('/callback', async (req, reply) => {
        const token = req.body?.token;
        if (!token)
            return reply.code(400).send({ error: 'Falta el token' });
        const hash = createHash('sha256').update(token).digest('hex');
        const registro = await prisma.loginToken.findUnique({
            where: { tokenHash: hash },
            include: { user: true },
        });
        if (!registro || registro.usedAt || registro.expiresAt < new Date() || !registro.user.active) {
            return reply.code(401).send({ error: 'Enlace inválido o vencido' });
        }
        await prisma.loginToken.update({ where: { id: registro.id }, data: { usedAt: new Date() } });
        const sesion = await abrirSesion(req, reply, registro.user, 'enlace');
        return { ok: true, user: sesion };
    });
    /**
     * Entrada con correo y contraseña. Acotada al subdominio igual que el enlace.
     *
     * Un solo mensaje para correo inexistente, sin contraseña o contraseña errada: distinguirlos
     * le diría a quien prueba qué correos tienen cuenta.
     */
    app.post('/login', async (req, reply) => {
        const parsed = loginInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Correo o contraseña inválidos' });
        const email = parsed.data.email.toLowerCase();
        const clave = `${req.ip}|${req.tenant?.id ?? '-'}|${email}`;
        if (bloqueado(clave)) {
            return reply
                .code(429)
                .send({ error: 'Demasiados intentos. Espera 15 minutos o entra con enlace al correo.' });
        }
        /**
         * Con subdominio hay a lo sumo un candidato. Sin él (modo de un solo cliente) el mismo
         * correo puede estar en varias organizaciones: se prueba la contraseña contra cada una
         * y entra a la que coincide, en vez de tomar una al azar como hacía `findFirst`.
         */
        const candidatos = await prisma.user.findMany({
            where: {
                email,
                active: true,
                passwordHash: { not: null },
                ...(req.tenant ? { organizationId: req.tenant.id } : {}),
            },
            orderBy: { createdAt: 'asc' },
        });
        if (candidatos.length === 0) {
            await verifyPassword(parsed.data.password, await hashDeRelleno());
        }
        let user;
        for (const c of candidatos) {
            if (await verifyPassword(parsed.data.password, c.passwordHash)) {
                user = c;
                break;
            }
        }
        if (!user) {
            anotarFallo(clave);
            return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
        }
        fallos.delete(clave);
        const sesion = await abrirSesion(req, reply, user, 'password');
        return { ok: true, user: sesion };
    });
    /** Define o cambia la contraseña propia. */
    app.post('/password', { preHandler: requireAuth }, async (req, reply) => {
        const parsed = cambiarPasswordInput.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: 'La contraseña debe tener al menos 10 caracteres' });
        }
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            return reply.code(401).send({ error: 'No autenticado' });
        if (user.passwordHash) {
            const ok = await verifyPassword(parsed.data.actual ?? '', user.passwordHash);
            if (!ok)
                return reply.code(403).send({ error: 'La contraseña actual no es correcta' });
        }
        await prisma.user.update({
            where: { id: user.id },
            data: { passwordHash: await hashPassword(parsed.data.nueva), passwordChangedAt: new Date() },
        });
        await audit(user.organizationId, user.id, 'user.password', { ip: req.ip });
        return { ok: true };
    });
    app.get('/me', async (req, reply) => {
        await loadUser(req);
        if (!req.user)
            return reply.code(401).send({ error: 'No autenticado' });
        const org = await prisma.organization.findUnique({
            where: { id: req.user.organizationId },
            select: { id: true, name: true },
        });
        const propio = await prisma.user.findUnique({
            where: { id: req.user.id },
            select: { passwordHash: true },
        });
        return { user: req.user, organization: org, tienePassword: !!propio?.passwordHash };
    });
    app.post('/logout', async (_req, reply) => {
        clearSession(reply);
        return { ok: true };
    });
}
