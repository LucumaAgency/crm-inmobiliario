import { privadosDir } from '../lib/privados.js';
export interface ItemProforma {
    unitId: string;
    kind: string;
    code: string;
    typology: string | null;
    bedrooms: number | null;
    bathrooms: number | null;
    areaM2: number | null;
    price: number;
}
export interface EmitirProformaInput {
    organizationId: string;
    leadId: string;
    userId: string;
    unitIds: string[];
    /** Uno de los dos; si vienen ambos manda el porcentaje. */
    discountPct?: number;
    discountAmount?: number;
    note?: string;
    validDays?: number;
}
export declare class ErrorProforma extends Error {
    statusCode: number;
    constructor(message: string, statusCode?: number);
}
/** Tope efectivo del usuario: el propio, si no el de la organización, si no sin tope. */
export declare function topeDescuento(userId: string, organizationId: string): Promise<number | null>;
export declare function emitirProforma(input: EmitirProformaInput): Promise<{
    number: string;
    id: string;
    organizationId: string;
    leadId: string;
    projectId: string;
    createdById: string | null;
    year: number;
    seq: number;
    client: import("@prisma/client/runtime/library").JsonValue;
    agent: import("@prisma/client/runtime/library").JsonValue;
    items: import("@prisma/client/runtime/library").JsonValue;
    currency: string;
    listTotal: import("@prisma/client/runtime/library").Decimal;
    discountPct: import("@prisma/client/runtime/library").Decimal;
    discountAmount: import("@prisma/client/runtime/library").Decimal;
    finalTotal: import("@prisma/client/runtime/library").Decimal;
    validDays: number;
    validUntil: Date;
    note: string | null;
    pdfPath: string;
    emailSentAt: Date | null;
    emailTo: string | null;
    whatsappSentAt: Date | null;
    createdAt: Date;
}>;
export declare function moneda(n: number, currency: string): string;
export declare function rutaPdf(pdfPath: string): string;
export { privadosDir };
