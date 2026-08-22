export declare function sendMail(opts: {
    to: string | string[];
    subject: string;
    html: string;
    text?: string;
}): Promise<any>;
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
