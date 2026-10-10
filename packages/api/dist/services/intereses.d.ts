import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
type Tx = Prisma.TransactionClient | typeof prisma;
export interface InteresesInput {
    typologyIds?: string[];
    unitIds?: string[];
}
/**
 * Comprueba que las tipologías y unidades existen y pertenecen al proyecto del lead.
 *
 * Es la misma defensa que tiene la reasignación: sin ella, un id de otra organización
 * pasaría por el cuerpo de la petición y quedaría colgado de un lead ajeno. Devuelve los
 * registros ya cargados para no repetir la consulta al escribir la actividad.
 */
export declare function validarIntereses(projectId: string | null, input: InteresesInput): Promise<{
    tipologias: never[] | {
        name: string;
        id: string;
        projectId: string;
        currency: string;
        createdAt: Date;
        updatedAt: Date;
        code: string | null;
        active: boolean;
        bedrooms: number | null;
        bathrooms: number | null;
        areaM2: Prisma.Decimal | null;
        priceFrom: Prisma.Decimal | null;
        description: string | null;
        planUrl: string | null;
        imageUrl: string | null;
        position: number;
    }[];
    unidades: never[] | {
        typology: string | null;
        id: string;
        projectId: string;
        currency: string;
        status: import(".prisma/client").$Enums.UnitStatus;
        updatedAt: Date;
        code: string;
        typologyId: string | null;
        kind: import(".prisma/client").$Enums.UnitKind;
        bedrooms: number | null;
        bathrooms: number | null;
        areaM2: Prisma.Decimal | null;
        price: Prisma.Decimal | null;
        floor: number | null;
        extra: Prisma.JsonValue | null;
    }[];
}>;
/** Reemplaza el conjunto completo de intereses del lead (lo que el asesor dejó marcado). */
export declare function reemplazarIntereses(tx: Tx, leadId: string, input: Required<InteresesInput>): Promise<void>;
/** Suma sin quitar: lo usa la captura, que nunca debe borrar lo que el asesor marcó. */
export declare function sumarIntereses(tx: Tx, leadId: string, input: InteresesInput): Promise<void>;
/** Al cambiar de proyecto, los intereses del anterior ya no aplican. */
export declare function vaciarIntereses(tx: Tx, leadId: string): Promise<void>;
export declare const includeIntereses: {
    typologyInterests: {
        include: {
            typology: {
                select: {
                    id: boolean;
                    name: boolean;
                    bedrooms: boolean;
                    areaM2: boolean;
                    priceFrom: boolean;
                    currency: boolean;
                };
            };
        };
        orderBy: {
            createdAt: "asc";
        };
    };
    unitInterests: {
        include: {
            unit: {
                select: {
                    id: boolean;
                    code: boolean;
                    status: boolean;
                    bedrooms: boolean;
                    areaM2: boolean;
                    price: boolean;
                    currency: boolean;
                    typologyRef: {
                        select: {
                            id: boolean;
                            name: boolean;
                        };
                    };
                };
            };
        };
        orderBy: {
            createdAt: "asc";
        };
    };
};
export {};
