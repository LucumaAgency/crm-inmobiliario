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
    /** Agencia: nombre del servicio (proyecto), forma de cobro y para quién. */
    service?: string;
    billing?: string | null;
    forWhom?: string | null;
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
    /** Fecha de vencimiento elegida por el asesor (YYYY-MM-DD); manda sobre validDays. */
    validUntil?: string;
    /** Nombre y teléfono del asesor tal como deben salir; por defecto los del usuario. */
    agentName?: string;
    agentPhone?: string;
}
/** Nota por defecto de una propuesta de agencia, si la organización no escribió la suya. */
export declare const PROPUESTA_NOTA_AGENCIA = "La presente propuesta tiene una validez de quince (15) d\u00EDas calendario desde su emisi\u00F3n. Los servicios por proyecto se pagan 50% al inicio y 50% a la entrega; los servicios recurrentes se facturan por adelantado cada mes. Los precios est\u00E1n expresados en soles.";
export declare class ErrorProforma extends Error {
    statusCode: number;
    constructor(message: string, statusCode?: number);
}
/** Tope efectivo del usuario: el propio, si no el de la organización, si no sin tope. */
export declare function topeDescuento(userId: string, organizationId: string): Promise<number | null>;
export declare function emitirProforma(input: EmitirProformaInput): Promise<{
    number: string;
    id: string;
    createdAt: Date;
    projectId: string;
    currency: string;
    leadId: string;
    organizationId: string;
    year: number;
    createdById: string | null;
    seq: number;
    client: import("@prisma/client/runtime/library").JsonValue;
    agent: import("@prisma/client/runtime/library").JsonValue;
    items: import("@prisma/client/runtime/library").JsonValue;
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
}>;
export declare function moneda(n: number, currency: string): string;
export declare function rutaPdf(pdfPath: string): string;
export { privadosDir };
