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
    /** /v3/projects/{id}: ubicación, construcción, garantías, redes. Desde 2026-10-16. */
    proyectoDetalle?: Plano | null;
    /** /v3/projects/{id}/images (renders del proyecto). */
    proyectoImagenes?: Plano[];
    /** /v3/units/{id} por id: piso, áreas techada/libre, vista, dormitorios, fechas. */
    unidadesDetalle?: Record<string, Plano>;
    /** Proyecto de Sperant del que salieron tipologías y unidades. */
    inventarioDe?: {
        id: number;
        nombre: string;
    } | null;
    /** Nombres de tipologías de los OTROS proyectos de la cuenta (para limpiar las que se colaron). */
    tiposOtrosProyectos?: string[];
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
    /**
     * Códigos de unidades cuyos cambios se aprueban. Una unidad que ya existe en el CRM y
     * difiere de Sperant SOLO se actualiza si su código está aquí: la simulación devuelve la
     * comparativa (`unidades.diferencias`) y la persona aprueba una por una. Las unidades
     * nuevas se crean siempre; las iguales no se tocan.
     */
    unidadesAprobadas?: string[];
    /** Quién aprueba (para la auditoría de precios). */
    userId?: string | null;
}
export interface DiferenciaUnidad {
    code: string;
    /** Campos que difieren: campo → { crm, sperant }. */
    cambios: Record<string, {
        crm: string | number | null;
        sperant: string | number | null;
    }>;
    aprobada: boolean;
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
        sinCambios: number;
        pendientes: number;
        tipologiasCreadas: number;
        diferencias: DiferenciaUnidad[];
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
        proyecto: string | null;
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
export interface InformeCompletar {
    simulacion: boolean;
    leadsRevisados: number;
    leadsCompletados: number;
    fusionesCompletadas: number;
    documentosFalsosLimpiados: number;
    proformasCompletadas: number;
    sinLeadEnCrm: number;
    /** Diagnóstico: lo que explica números raros. */
    diagnostico: {
        clientesEnExport: number;
        /** Clientes sin ficha de detalle en el export (la exportación se cortó para ellos). */
        sinDetalleEnExport: number;
        documentosAutoEnExport: number;
        /** El contacto del CRM no tiene documento: ya se quitó, o el contacto existía antes de importar. */
        documentoAutoContactoSinDocumento: number;
        /** El contacto del CRM tiene otro documento (existía antes con DNI real, o se editó). */
        documentoAutoContactoConOtro: number;
        proformasEnExport: number;
        notasProformaExistentes: number;
        /** Proformas del export que no tenían nota en el lead (importación sin proformas). */
        notasProformaACrear: number;
    };
    inventario: {
        /** La exportación es anterior al detalle de unidades: hay que exportar de nuevo. */
        faltaExportarDetalle: boolean;
        proyecto: string | null;
        unidadesCompletadas: number;
        unidadesSinParejaEnCrm: string[];
        tipologiasCompletadas: number;
        imagenesCopiadas: number;
        imagenesConError: number;
        direccionCompletada: boolean;
        /** Proyecto de Sperant del que viene el inventario del export. */
        inventarioDe: string | null;
        /** Unidades que vinieron de otro proyecto de Sperant y no existen en este: se quitan. */
        unidadesDeOtroProyecto: string[];
        /** Tipologías sin unidades que no están en este proyecto de Sperant: se quitan. */
        tipologiasDeOtroProyecto: string[];
        /** Tipologías ajenas que no se pueden quitar todavía (tienen unidades o interesados). */
        tipologiasAjenasEnUso: string[];
    };
    /** Leads importados sin etapa ni asesor (la exportación no trajo su proyecto) y que ahora se reparan. */
    reparados: {
        leads: number;
        conEtapa: number;
        perdidos: number;
        sinEtapaEnCrm: string[];
    };
}
/**
 * Completa los leads YA importados con la ficha completa de Sperant.
 *
 * La primera versión del importador guardaba solo lo que el CRM tiene como campo (nombre,
 * teléfono, etapa…) y se perdía el resto: género, estado civil, ubicación, pareja, teléfono
 * principal, campos extra, interacciones manuales y digitales, cotitulares de las proformas.
 * Esto lo agrega dentro de `attribution.sperant` sin tocar nada de lo que el equipo ya editó
 * en el CRM (etapa, asesor, datos de contacto). Además quita los documentos `auto-…` que
 * Sperant pone cuando no hay DNI, solo si el contacto sigue teniendo exactamente ese valor.
 *
 * Idempotente: correrlo dos veces no cambia nada la segunda.
 */
export declare function completarDatos(organizationId: string, simulacion: boolean): Promise<InformeCompletar>;
/** Arranca la importación real en segundo plano. */
export declare function iniciarImportacion(organizationId: string, mapa: MapaImporte): Promise<void>;
/**
 * Asesores de Sperant presentes en los leads importados, con cuántos leads tiene cada uno y
 * quién los tiene hoy en el CRM. El nombre y correo sugeridos salen de los usuarios de Sperant
 * del export (si el asesor aparece ahí).
 */
export declare function asesoresSperant(organizationId: string): Promise<{
    username: string;
    leads: number;
    abiertos: number;
    duenosActuales: {
        nombre: string;
        leads: number;
    }[];
    sugerido: {
        nombre: string;
        email: string;
    } | null;
}[]>;
export interface AsignacionAsesor {
    username: string;
    /** Usuario existente del CRM… */
    userId?: string;
    /** …o uno nuevo, que entra con enlace al correo (sin contraseña). */
    crear?: {
        name: string;
        email: string;
        role: 'asesor' | 'gerente';
    };
}
/**
 * Reasigna los leads importados según quién los llevaba en Sperant (`attribution.sperant.asesor`),
 * creando los usuarios que hagan falta. Pisa al dueño actual a propósito: es para deshacer una
 * asignación provisional. No toca leads que no vinieron de Sperant.
 *
 * Sin aviso por correo (serían cientos); cada lead recibe su asignación en el historial y una
 * actividad «Asesor → X (según Sperant)».
 */
export declare function reasignarPorAsesor(organizationId: string, porUserId: string, asignaciones: AsignacionAsesor[]): Promise<{
    username: string;
    usuario: string;
    creado: boolean;
    leads: number;
}[]>;
export {};
