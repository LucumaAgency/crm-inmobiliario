type Plano = Record<string, unknown>;
export interface DatosExport {
    version: 1;
    exportadoEl: string;
    catalogos: Record<string, Plano[]>;
    projects: Plano[];
    types: Plano[];
    units: Plano[];
    users: Plano[];
    /** Listado crudo de /v3/clients (8 columnas). Es la lista de trabajo. */
    clientes: Plano[];
    /** /v3/clients/{id}, por id. */
    detalle: Record<string, Plano>;
    /** /v3/clients/{id}/projects, por id (puede ser varios; en Bastión siempre uno). */
    proyectos: Record<string, Plano[]>;
    /** /v3/budgets con titulares y unidades. */
    budgets: Plano[];
}
export type Fase = 'sin_token' | 'listo' | 'exportando' | 'exportado' | 'importando' | 'importado' | 'error';
export interface Estado {
    fase: Fase;
    /** Qué tarea corre (o corrió): exportar | importar. */
    tarea?: 'exportar' | 'importar';
    inicio?: string;
    fin?: string;
    latido?: string;
    total?: number;
    hechos?: number;
    error?: string | null;
    /** Resultado de la última importación real. */
    importe?: InformeImporte;
}
export interface MapaImporte {
    /** id del proyecto del CRM donde entran los leads y el inventario. */
    crmProjectId: string;
    /** segment_name de Sperant → id de etapa del CRM, `crear`, `crear_perdida` o null (omitir el lead). */
    etapas: Record<string, string | null>;
    /** seller_username de Sperant → id de usuario del CRM, o null (sin dueño). */
    asesores: Record<string, string | null>;
    importarUnidades: boolean;
    importarProformas: boolean;
}
export interface InformeImporte {
    simulacion: boolean;
    leads: {
        total: number;
        nuevos: number;
        fusionados: number;
        yaImportados: number;
        omitidos: number;
        sinEtapa: number;
        sinAsesor: number;
        errores: number;
    };
    contactos: {
        nuevos: number;
        existentes: number;
    };
    unidades: {
        creadas: number;
        actualizadas: number;
        tipologiasCreadas: number;
    };
    proformas: {
        notas: number;
    };
    etapasCreadas: string[];
    erroresDetalle: {
        clientId: number;
        motivo: string;
    }[];
    fin?: string;
}
export declare function leerEstado(organizationId: string): Estado;
export declare function hayDatos(organizationId: string): boolean;
/** Borra el export (datos personales) una vez terminada la migración. */
export declare function borrarDatos(organizationId: string): void;
/** ¿Hay una tarea viva? Viva = en marcha y con latido reciente. */
export declare function tareaEnCurso(organizationId: string): boolean;
export declare function probar(organizationId: string): Promise<{
    ok: boolean;
    proyectos: {
        id: number;
        code: string;
        name: string;
    }[];
    totalLeads: number;
}>;
/**
 * Arranca (o reanuda) la exportación en segundo plano. Devuelve enseguida.
 * Lanza si ya hay una viva.
 */
export declare function iniciarExportacion(organizationId: string): Promise<void>;
export declare function resumen(organizationId: string): {
    exportadoEl: string;
    leads: {
        total: number;
        desde: string;
        hasta: string;
        porMes: {
            valor: string;
            n: number;
        }[];
        proyectos: {
            valor: string;
            n: number;
        }[];
        etapas: {
            valor: string;
            n: number;
        }[];
        asesores: {
            valor: string;
            n: number;
        }[];
        canales: {
            valor: string;
            n: number;
        }[];
        medios: {
            valor: string;
            n: number;
        }[];
        interes: {
            valor: string;
            n: number;
        }[];
        motivos: {
            valor: string;
            n: number;
        }[];
        sinTelefono: number;
        sinCorreo: number;
        sinDocumento: number;
        conObservacion: number;
        sinNumeroWhatsApp: number;
    };
    inventario: {
        tipologias: string[];
        unidades: number;
        porEstado: {
            valor: string;
            n: number;
        }[];
        porTipo: {
            valor: string;
            n: number;
        }[];
    };
    proformas: {
        total: number;
        activas: number;
        financiamiento: {
            valor: string;
            n: number;
        }[];
    };
    usuarios: {
        username: string;
        nombre: string;
        email: string;
    }[];
} | null;
/**
 * Propuesta de mapa: etapas por nombre parecido, asesores por correo/usuario. La persona
 * lo corrige en pantalla; esto solo ahorra clics.
 */
export declare function sugerirMapa(organizationId: string): Promise<{
    etapas: Record<string, string | null>;
    asesores: Record<string, string | null>;
    etapasCrm: {
        id: string;
        name: string;
        isLost: boolean;
        isWon: boolean;
    }[];
    usuariosCrm: {
        id: string;
        name: string;
        email: string;
    }[];
} | null>;
/**
 * Importa (o simula). Con `simulacion` no escribe nada en la base.
 *
 * Idempotencia: los leads ya importados se reconocen por `attribution.sperant.client_id`.
 * Fusión: si el contacto ya tiene un lead activo en el mismo proyecto (por ejemplo uno que
 * entró por WhatsApp durante el demo), no se crea otro: se le anota la procedencia y se
 * completan dueño y etapa si estaban vacíos.
 */
export declare function importar(organizationId: string, mapa: MapaImporte, simulacion: boolean): Promise<InformeImporte>;
/** Arranca la importación real en segundo plano. */
export declare function iniciarImportacion(organizationId: string, mapa: MapaImporte): Promise<void>;
export {};
