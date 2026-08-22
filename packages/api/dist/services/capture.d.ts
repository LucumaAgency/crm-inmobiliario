import { type FormSchema, type SubmissionInput } from '@lucuma-crm/shared';
export interface CaptureContext {
    organizationId: string;
    siteId?: string | null;
    formId?: string | null;
    formVersion?: number;
    source?: string;
    ip?: string;
    userAgent?: string;
    notifyEmails?: string[];
    projectId?: string | null;
}
export interface CaptureResult {
    leadId: string;
    duplicated: boolean;
    isSpam: boolean;
}
/**
 * Puerta única de entrada de leads. Toda fuente (formulario web, WhatsApp, Meta Ads,
 * importación, alta manual) termina aquí.
 */
export declare function captureLead(input: SubmissionInput, schema: FormSchema | null, ctx: CaptureContext): Promise<CaptureResult>;
export declare function leadUrl(leadId: string): string;
