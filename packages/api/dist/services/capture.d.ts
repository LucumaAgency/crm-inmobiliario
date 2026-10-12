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
    /**
     * Contacto ya resuelto por quien llama. Lo usa WhatsApp cuando el cliente escribe
     * sin compartir su número (`from_user_id`): no hay teléfono ni correo con que
     * deduplicar, y el contacto de la conversación es el único ancla.
     */
    contactId?: string;
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
/**
 * Enlace a la ficha del lead.
 *
 * El worker manda correos fuera de cualquier petición HTTP, así que no puede deducir el
 * subdominio del host: se lo dice el slug de la organización del lead. Sin dominio base
 * configurado cae en `APP_URL`, que es el modo de un solo cliente.
 */
export declare function leadUrl(leadId: string, orgSlug?: string | null): string;
