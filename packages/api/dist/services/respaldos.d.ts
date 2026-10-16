import { Prisma } from '@prisma/client';
export type Variante = 'interno' | 'cliente';
/** Versión del formato. Si cambia la estructura del ZIP, se sube y el restaurador lo comprueba. */
export declare const FORMATO = 1;
/**
 * Tablas que entran, en el orden en que se restauran (cada una después de aquellas a las
 * que apunta). Quedan fuera `login_tokens` (enlaces de acceso de un solo uso) y `jobs` (la
 * cola es de la instalación, no de una organización).
 */
export declare const TABLAS: {
    modelo: Prisma.ModelName;
    where: (org: string) => object;
}[];
type Fila = Record<string, unknown>;
type Delegado = {
    findMany: (args: object) => Promise<Fila[]>;
    createMany: (args: object) => Promise<{
        count: number;
    }>;
};
export declare function delegado(modelo: Prisma.ModelName): Delegado;
export interface Resultado {
    ruta: string;
    nombre: string;
    bytes: number;
    conteos: Record<string, number>;
    archivos: number;
}
/** Arma el ZIP de una organización en `destino`. No lo sube ni lo registra. */
export declare function generarRespaldo(organizationId: string, variante: Variante, destino: string): Promise<Resultado>;
export declare const dirAutomaticos: (org: string) => string;
export declare const dirDescargas: (org: string) => string;
export interface EstadoRespaldo {
    /** Último que llegó a Drive. Es el que cuenta: uno que solo está en el servidor no protege de perderlo. */
    ultimoOk: string | null;
    /** Último generado, haya subido o no. */
    ultimoLocal: string | null;
    ultimoIntento: string | null;
    archivo: string | null;
    bytes: number | null;
    /** En Drive: id del archivo, o el motivo por el que no se subió. */
    drive: {
        id: string;
    } | {
        error: string;
    } | null;
    error: string | null;
}
export declare function leerEstadoRespaldo(organizationId: string): Promise<EstadoRespaldo>;
/** Respaldo interno + subida a Drive + poda, para una organización. */
export declare function respaldarOrganizacion(organizationId: string): Promise<EstadoRespaldo>;
/**
 * Lo llama cada latido. Casi siempre no hace nada: mira si a alguna organización le toca y
 * sale. Un cerrojo en disco evita que dos procesos de Passenger respalden a la vez; si un
 * proceso murió con el cerrojo puesto, a las 2 horas se considera abandonado.
 */
export declare function respaldosAutomaticos(): Promise<void>;
export declare function listarZips(dir: string): {
    nombre: string;
    bytes: number;
    creadoEl: string;
}[];
/** Respaldo para que el cliente lo descargue. Se guardan los dos últimos. */
export declare function generarDescarga(organizationId: string): Promise<Resultado>;
export {};
