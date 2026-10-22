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
export type DatosContacto = {
    fname: string;
    lname?: string;
    email: string | null;
    phone: string | null;
    document: string | null;
};
/** Busca por documento → email → teléfono. Null nunca identifica a nadie. */
export declare function buscarContacto(organizationId: string, d: DatosContacto): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    organizationId: string;
    instagram: string | null;
    facebook: string | null;
    fname: string;
    lname: string | null;
    email: string | null;
    phone: string | null;
    document: string | null;
    documentType: string | null;
    company: string | null;
    tiktok: string | null;
    linkedin: string | null;
    website: string | null;
} | null>;
/**
 * Identidad del contacto.
 *
 * El `findFirst` seguido de `create` es una condición de carrera: dos envíos simultáneos
 * de la misma persona (doble clic con conexión lenta) buscan a la vez, ninguno encuentra
 * nada y ambos crean. Los índices únicos de `Contact` hacen que MariaDB rechace el segundo
 * con P2002; aquí se traduce esa colisión en "otro proceso ya lo creó" y se reintenta la
 * búsqueda, que es el resultado correcto. La idempotencia no cubre este caso: son dos
 * envíos distintos, con claves distintas.
 */
export declare function upsertContacto(organizationId: string, d: DatosContacto): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    organizationId: string;
    instagram: string | null;
    facebook: string | null;
    fname: string;
    lname: string | null;
    email: string | null;
    phone: string | null;
    document: string | null;
    documentType: string | null;
    company: string | null;
    tiktok: string | null;
    linkedin: string | null;
    website: string | null;
}>;
/**
 * Enlace a la ficha del lead.
 *
 * El worker manda correos fuera de cualquier petición HTTP, así que no puede deducir el
 * subdominio del host: se lo dice el slug de la organización del lead. Sin dominio base
 * configurado cae en `APP_URL`, que es el modo de un solo cliente.
 */
export declare function leadUrl(leadId: string, orgSlug?: string | null): string;
