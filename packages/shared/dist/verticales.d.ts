/**
 * Verticales: qué vende cada organización y cómo se llaman las cosas.
 *
 * El modelo de datos es uno solo: Project → Unit. En una inmobiliaria el Project es un
 * edificio y la Unit un departamento; en una agencia el Project es un servicio (SEO, Meta
 * Ads) y la Unit un paquete (Base, Crecimiento, Premium). Cambian las etiquetas, qué campos
 * se muestran y cómo se llama el documento que formaliza el precio. Nada más.
 */
export type Vertical = 'inmobiliaria' | 'agencia';
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
    /** Placeholder del nombre de un proyecto nuevo. */
    ejemploProyecto: string;
    ejemploUnidad: string;
    /** Actividad presencial: Visita (a caseta) / Reunión. */
    visita: string;
}
export declare const ETIQUETAS: Record<Vertical, Etiquetas>;
export declare function esVertical(x: string): x is Vertical;
export declare function etiquetas(v: string | null | undefined): Etiquetas;
