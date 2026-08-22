import { createHash, randomBytes } from 'node:crypto';
import { magicLinkInput } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { audit, clearSession, issueSession, loadUser } from '../lib/auth.js';
import { magicLinkEmail, sendMail } from '../lib/mail.js';
const VIGENCIA_MIN = 20;
export default async function authRoutes(app) {
    /** Pide un magic link. Responde igual exista o no el correo, para no filtrar usuarios. */
    app.post('/magic-link', async (req, reply) => {
        const parsed = magicLinkInput.safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Correo inválido' });
        const user = await prisma.user.findFirst({
            where: { email: parsed.data.email.toLowerCase(), active: true },
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
            const url = `${env.appUrl.replace(/\/$/, '')}/auth/callback?token=${token}`;
            const mail = magicLinkEmail(url, user.name);
            await sendMail({ to: user.email, ...mail });
        }
        return { ok: true, message: 'Si el correo existe, te llegará un enlace de acceso.' };
    });
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
        await prisma.user.update({ where: { id: registro.user.id }, data: { lastLoginAt: new Date() } });
        const sesion = {
            id: registro.user.id,
            organizationId: registro.user.organizationId,
            role: registro.user.role,
            email: registro.user.email,
            name: registro.user.name,
        };
        issueSession(reply, sesion);
        await audit(sesion.organizationId, sesion.id, 'user.login', { ip: req.ip });
        return { ok: true, user: sesion };
    });
    app.get('/me', async (req, reply) => {
        await loadUser(req);
        if (!req.user)
            return reply.code(401).send({ error: 'No autenticado' });
        const org = await prisma.organization.findUnique({
            where: { id: req.user.organizationId },
            select: { id: true, name: true },
        });
        return { user: req.user, organization: org };
    });
    app.post('/logout', async (_req, reply) => {
        clearSession(reply);
        return { ok: true };
    });
}
