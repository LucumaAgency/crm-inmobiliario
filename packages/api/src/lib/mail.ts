import nodemailer from 'nodemailer';
import { env } from '../env.js';

let transport: nodemailer.Transporter | null = null;

function getTransport() {
  if (transport) return transport;
  if (!env.smtp.host) {
    // Sin SMTP configurado (desarrollo): se registra en consola en vez de enviar.
    transport = nodemailer.createTransport({ jsonTransport: true });
  } else {
    transport = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  }
  return transport;
}

export async function sendMail(opts: { to: string | string[]; subject: string; html: string; text?: string }) {
  const info = await getTransport().sendMail({
    from: env.smtp.from,
    to: Array.isArray(opts.to) ? opts.to.join(',') : opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  if (!env.smtp.host) console.log('[mail:dev]', opts.subject, '→', opts.to);
  return info;
}

export function magicLinkEmail(url: string, name: string) {
  return {
    subject: 'Tu acceso al CRM',
    html: `<p>Hola ${escapeHtml(name)},</p>
<p>Entra al CRM con este enlace. Vence en 20 minutos y sirve una sola vez.</p>
<p><a href="${url}" style="background:#174FCA;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block">Entrar al CRM</a></p>
<p style="color:#666;font-size:13px">Si no pediste este acceso, ignora este correo.</p>`,
    text: `Entra al CRM: ${url}`,
  };
}

export function newLeadEmail(lead: {
  contactName: string;
  phone?: string | null;
  email?: string | null;
  project?: string | null;
  unit?: string | null;
  message?: string | null;
  url: string;
}) {
  const row = (k: string, v?: string | null) =>
    v ? `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>` : '';
  return {
    subject: `Nuevo lead: ${lead.contactName}`,
    html: `<p>Entró un lead nuevo.</p>
<table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
${row('Nombre', lead.contactName)}${row('Teléfono', lead.phone)}${row('Correo', lead.email)}
${row('Proyecto', lead.project)}${row('Unidad de interés', lead.unit)}${row('Mensaje', lead.message)}
</table>
<p><a href="${lead.url}">Abrir en el CRM</a></p>`,
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
