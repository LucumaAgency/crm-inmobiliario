import { z } from 'zod';
/** Cuerpo de POST /api/v1/public/forms/:id/submissions (lo envía el conector WP). */
export declare const submissionInput: z.ZodObject<{
    /** UUID generado en el navegador. El reintento de la cola del plugin reusa el mismo. */
    idempotencyKey: z.ZodString;
    /** Valores del formulario: { fieldKey: valor } */
    values: z.ZodRecord<z.ZodString, z.ZodUnion<[z.ZodString, z.ZodNumber, z.ZodBoolean, z.ZodNull]>>;
    consent: z.ZodOptional<z.ZodObject<{
        accepted: z.ZodBoolean;
        version: z.ZodString;
        text: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        accepted: boolean;
        version: string;
        text?: string | undefined;
    }, {
        accepted: boolean;
        version: string;
        text?: string | undefined;
    }>>;
    attribution: z.ZodOptional<z.ZodObject<{
        first: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        last: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        gclid: z.ZodOptional<z.ZodString>;
        fbclid: z.ZodOptional<z.ZodString>;
        referrer: z.ZodOptional<z.ZodString>;
        landingPage: z.ZodOptional<z.ZodString>;
        pageUrl: z.ZodOptional<z.ZodString>;
        pageTitle: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        first?: Record<string, string> | undefined;
        last?: Record<string, string> | undefined;
        gclid?: string | undefined;
        fbclid?: string | undefined;
        referrer?: string | undefined;
        landingPage?: string | undefined;
        pageUrl?: string | undefined;
        pageTitle?: string | undefined;
    }, {
        first?: Record<string, string> | undefined;
        last?: Record<string, string> | undefined;
        gclid?: string | undefined;
        fbclid?: string | undefined;
        referrer?: string | undefined;
        landingPage?: string | undefined;
        pageUrl?: string | undefined;
        pageTitle?: string | undefined;
    }>>;
    antispam: z.ZodOptional<z.ZodObject<{
        honeypot: z.ZodOptional<z.ZodString>;
        elapsedSeconds: z.ZodOptional<z.ZodNumber>;
        turnstileToken: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        honeypot?: string | undefined;
        elapsedSeconds?: number | undefined;
        turnstileToken?: string | undefined;
    }, {
        honeypot?: string | undefined;
        elapsedSeconds?: number | undefined;
        turnstileToken?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    idempotencyKey: string;
    values: Record<string, string | number | boolean | null>;
    consent?: {
        accepted: boolean;
        version: string;
        text?: string | undefined;
    } | undefined;
    attribution?: {
        first?: Record<string, string> | undefined;
        last?: Record<string, string> | undefined;
        gclid?: string | undefined;
        fbclid?: string | undefined;
        referrer?: string | undefined;
        landingPage?: string | undefined;
        pageUrl?: string | undefined;
        pageTitle?: string | undefined;
    } | undefined;
    antispam?: {
        honeypot?: string | undefined;
        elapsedSeconds?: number | undefined;
        turnstileToken?: string | undefined;
    } | undefined;
}, {
    idempotencyKey: string;
    values: Record<string, string | number | boolean | null>;
    consent?: {
        accepted: boolean;
        version: string;
        text?: string | undefined;
    } | undefined;
    attribution?: {
        first?: Record<string, string> | undefined;
        last?: Record<string, string> | undefined;
        gclid?: string | undefined;
        fbclid?: string | undefined;
        referrer?: string | undefined;
        landingPage?: string | undefined;
        pageUrl?: string | undefined;
        pageTitle?: string | undefined;
    } | undefined;
    antispam?: {
        honeypot?: string | undefined;
        elapsedSeconds?: number | undefined;
        turnstileToken?: string | undefined;
    } | undefined;
}>;
export type SubmissionInput = z.infer<typeof submissionInput>;
export declare const submissionResult: z.ZodObject<{
    ok: z.ZodLiteral<true>;
    leadId: z.ZodString;
    duplicated: z.ZodBoolean;
    success: z.ZodObject<{
        type: z.ZodEnum<["message", "redirect"]>;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        type: "message" | "redirect";
    }, {
        value: string;
        type: "message" | "redirect";
    }>;
}, "strip", z.ZodTypeAny, {
    ok: true;
    leadId: string;
    duplicated: boolean;
    success: {
        value: string;
        type: "message" | "redirect";
    };
}, {
    ok: true;
    leadId: string;
    duplicated: boolean;
    success: {
        value: string;
        type: "message" | "redirect";
    };
}>;
export type SubmissionResult = z.infer<typeof submissionResult>;
export declare const leadListQuery: z.ZodObject<{
    q: z.ZodOptional<z.ZodString>;
    stageId: z.ZodOptional<z.ZodString>;
    ownerId: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["activo", "ganado", "perdido", "spam"]>>;
    page: z.ZodDefault<z.ZodNumber>;
    perPage: z.ZodDefault<z.ZodNumber>;
    /** `actividad` (por defecto) o `creacion`, el orden de antes. */
    orden: z.ZodDefault<z.ZodEnum<["actividad", "creacion"]>>;
}, "strip", z.ZodTypeAny, {
    page: number;
    perPage: number;
    orden: "actividad" | "creacion";
    status?: "activo" | "ganado" | "perdido" | "spam" | undefined;
    q?: string | undefined;
    stageId?: string | undefined;
    ownerId?: string | undefined;
    projectId?: string | undefined;
}, {
    status?: "activo" | "ganado" | "perdido" | "spam" | undefined;
    q?: string | undefined;
    stageId?: string | undefined;
    ownerId?: string | undefined;
    projectId?: string | undefined;
    page?: number | undefined;
    perPage?: number | undefined;
    orden?: "actividad" | "creacion" | undefined;
}>;
export declare const activityInput: z.ZodObject<{
    type: z.ZodEnum<["nota", "llamada", "whatsapp", "email", "visita"]>;
    body: z.ZodOptional<z.ZodString>;
    /** Regla del diseño: toda actividad cerrada agenda la siguiente. */
    nextDueAt: z.ZodOptional<z.ZodString>;
    nextType: z.ZodOptional<z.ZodEnum<["llamada", "whatsapp", "email", "visita", "nota"]>>;
}, "strip", z.ZodTypeAny, {
    type: "nota" | "llamada" | "whatsapp" | "email" | "visita";
    body?: string | undefined;
    nextDueAt?: string | undefined;
    nextType?: "nota" | "llamada" | "whatsapp" | "email" | "visita" | undefined;
}, {
    type: "nota" | "llamada" | "whatsapp" | "email" | "visita";
    body?: string | undefined;
    nextDueAt?: string | undefined;
    nextType?: "nota" | "llamada" | "whatsapp" | "email" | "visita" | undefined;
}>;
export declare const magicLinkInput: z.ZodObject<{
    email: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
}, {
    email: string;
}>;
/** Mínimo 10: sin segundo factor, la longitud es lo único que frena un diccionario. */
export declare const PASSWORD_MIN = 10;
export declare const passwordSchema: z.ZodString;
export declare const loginInput: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const cambiarPasswordInput: z.ZodObject<{
    /** Obligatoria si el usuario ya tiene una: una sesión robada no basta para cambiarla. */
    actual: z.ZodOptional<z.ZodString>;
    nueva: z.ZodString;
}, "strip", z.ZodTypeAny, {
    nueva: string;
    actual?: string | undefined;
}, {
    nueva: string;
    actual?: string | undefined;
}>;
