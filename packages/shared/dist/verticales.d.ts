/**
 * Verticales: qué vende cada organización y cómo se llaman las cosas.
 *
 * El modelo de datos es uno solo: Project → Unit. En una inmobiliaria el Project es un
 * edificio y la Unit un departamento; en una agencia el Project es un servicio (SEO, Meta
 * Ads) y la Unit un paquete (Base, Crecimiento, Premium). Cambian las etiquetas, qué campos
 * se muestran y cómo se llama el documento que formaliza el precio. Nada más.
 *
 * En una clínica (docs/29) el Project es una especialidad y la Unit un procedimiento; el
 * médico no vende ahí mismo: informa y deriva a una sede, y la venta se cierra cuando el
 * paciente se atiende.
 */
export type Vertical = 'inmobiliaria' | 'agencia' | 'clinica';
export declare const VERTICALES: Vertical[];
export interface Etiquetas {
    /** Nombre del vertical para mostrar. */
    vertical: string;
    proyecto: string;
    proyectos: string;
    unidad: string;
    unidades: string;
    /** Inventario / Catálogo. */
    inventario: string;
    /** Proforma / Propuesta. */
    documento: string;
    documentos: string;
    /** «Datos de la inmobiliaria» / «Datos de la agencia». */
    datosEmisor: string;
    /** Si el vertical usa tipologías (solo inmobiliaria). */
    usaTipologias: boolean;
    /** Si las unidades tienen dormitorios/área/piso/estado de stock. */
    usaStock: boolean;
    /**
     * Catálogo de precios (servicios → paquetes, especialidades → procedimientos) en vez de
     * inventario (proyectos → tipologías → unidades).
     */
    usaCatalogo: boolean;
    /** Si emite proformas/propuestas en PDF desde la ficha. */
    usaDocumento: boolean;
    /** Placeholder del nombre de un proyecto nuevo. */
    ejemploProyecto: string;
    ejemploUnidad: string;
    /** Actividad presencial: Visita (a caseta) / Reunión. */
    visita: string;
}
export declare const ETIQUETAS: Record<Vertical, Etiquetas>;
export declare function esVertical(x: string): x is Vertical;
export declare function etiquetas(v: string | null | undefined): Etiquetas;
/**
 * Slug de la etapa «Derivado a clínica». El slug no cambia al renombrar la etapa, así que es
 * lo que identifica el paso en el que se pide la sede.
 */
export declare const ETAPA_DERIVADO = "derivado-a-clinica";
/** Sede a la que el médico deriva pacientes (Ajustes → Sedes). */
export type Sede = {
    nombre: string;
    direccion?: string | null;
    telefonoCitas?: string | null;
    enlace?: string | null;
};
/**
 * Orígenes que cuentan como «llegó por los canales de Lucuma» para el cobro por paciente
 * (docs/29 §6): formulario web, WhatsApp, Meta y la llamada que entra por Google/la web.
 * Los demás orígenes del alta manual (referido, clínica, ya era paciente, otro) no cuentan.
 */
export declare const ORIGENES_PROPIOS: readonly ["web_form", "whatsapp", "meta_ads", "llamada"];
/** Opciones de «¿Cómo llegó?» en el alta manual de una clínica. */
export declare const ORIGENES_MANUALES_CLINICA: {
    valor: string;
    texto: string;
}[];
export declare function esOrigenPropio(source: string | null | undefined): boolean;
/**
 * Paciente cobrable (S/ 100 por paciente, docs/29 §6): llegó por canales de Lucuma, está
 * atendido y el procedimiento que se le hizo es una cirugía.
 */
export declare function esCobrableClinica(l: {
    source: string;
    wonAt: Date | string | null;
    procedure: {
        extra: unknown;
    } | null;
}): boolean;
