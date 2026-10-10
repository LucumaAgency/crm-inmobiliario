export declare function sendMail(opts: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
    /** Nombre visible del remitente («Alonso · Bastión»); la dirección sigue siendo la del SMTP. */
    fromName?: string;
    replyTo?: string;
    bcc?: string | string[];
    attachments?: {
        filename: string;
        path: string;
        contentType?: string;
    }[];
}): Promise<any>;
export declare function proformaEmail(d: {
    clientName: string;
    projectName: string;
    number: string;
    agentName: string;
    agentPhone: string | null;
    validUntil: string;
    finalTotal: string;
}): {
    subject: string;
    html: string;
    text: string;
};
export declare function magicLinkEmail(url: string, name: string): {
    subject: string;
    html: string;
    text: string;
};
export declare function newLeadEmail(lead: {
    contactName: string;
    phone?: string | null;
    email?: string | null;
    project?: string | null;
    unit?: string | null;
    message?: string | null;
    url: string;
}): {
    subject: string;
    html: string;
};
