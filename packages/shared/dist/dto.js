import { z } from 'zod';
/** Cuerpo de POST /api/v1/public/forms/:id/submissions (lo envía el conector WP). */
export const submissionInput = z.object({
    /** UUID generado en el navegador. El reintento de la cola del plugin reusa el mismo. */
    idempotencyKey: z.string().min(8).max(64),
    /** Valores del formulario: { fieldKey: valor } */
    values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
    consent: z
        .object({
        accepted: z.boolean(),
        version: z.string(),
        text: z.string().optional(),
    })
        .optional(),
    attribution: z
        .object({
        first: z.record(z.string()).optional(),
        last: z.record(z.string()).optional(),
        gclid: z.string().optional(),
        fbclid: z.string().optional(),
        referrer: z.string().optional(),
        landingPage: z.string().optional(),
        pageUrl: z.string().optional(),
        pageTitle: z.string().optional(),
    })
        .optional(),
    antispam: z
        .object({
        honeypot: z.string().optional(),
        elapsedSeconds: z.number().optional(),
        turnstileToken: z.string().optional(),
    })
        .optional(),
});
export const submissionResult = z.object({
    ok: z.literal(true),
    leadId: z.string(),
    duplicated: z.boolean(),
    success: z.object({ type: z.enum(['message', 'redirect']), value: z.string() }),
});
export const leadListQuery = z.object({
    q: z.string().optional(),
    stageId: z.string().optional(),
    ownerId: z.string().optional(),
    projectId: z.string().optional(),
    status: z.enum(['activo', 'ganado', 'perdido', 'spam']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(100).default(25),
});
export const activityInput = z.object({
    type: z.enum(['nota', 'llamada', 'whatsapp', 'email', 'visita']),
    body: z.string().max(5000).optional(),
    /** Regla del diseño: toda actividad cerrada agenda la siguiente. */
    nextDueAt: z.string().datetime().optional(),
    nextType: z.enum(['llamada', 'whatsapp', 'email', 'visita', 'nota']).optional(),
});
export const magicLinkInput = z.object({ email: z.string().email() });
