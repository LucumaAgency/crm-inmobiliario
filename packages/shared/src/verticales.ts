/**
 * Verticales: qué vende cada organización y cómo se llaman las cosas.
 *
 * El modelo de datos es uno solo: Project → Unit. En una inmobiliaria el Project es un
 * edificio y la Unit un departamento; en una agencia el Project es un servicio (SEO, Meta
 * Ads) y la Unit un paquete (Base, Crecimiento, Premium). Cambian las etiquetas, qué campos
 * se muestran y cómo se llama el documento que formaliza el precio. Nada más.
 */
export type Vertical = 'inmobiliaria' | 'agencia';

export const VERTICALES: Vertical[] = ['inmobiliaria', 'agencia'];

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

export const ETIQUETAS: Record<Vertical, Etiquetas> = {
  inmobiliaria: {
    vertical: 'Inmobiliaria',
    proyecto: 'Proyecto',
    proyectos: 'Proyectos',
    unidad: 'Unidad',
    unidades: 'Unidades',
    inventario: 'Inventario',
    documento: 'Proforma',
    documentos: 'Proformas',
    datosEmisor: 'Datos de la inmobiliaria',
    usaTipologias: true,
    usaStock: true,
    ejemploProyecto: 'Edificio Domus',
    ejemploUnidad: '601',
    visita: 'Visita',
  },
  agencia: {
    vertical: 'Agencia',
    proyecto: 'Servicio',
    proyectos: 'Servicios',
    unidad: 'Paquete',
    unidades: 'Paquetes',
    inventario: 'Catálogo',
    documento: 'Propuesta',
    documentos: 'Propuestas',
    datosEmisor: 'Datos de la agencia',
    usaTipologias: false,
    usaStock: false,
    ejemploProyecto: 'Posicionamiento SEO',
    ejemploUnidad: 'Crecimiento',
    visita: 'Reunión',
  },
};

export function esVertical(x: string): x is Vertical {
  return (VERTICALES as string[]).includes(x);
}

export function etiquetas(v: string | null | undefined): Etiquetas {
  return ETIQUETAS[v && esVertical(v) ? v : 'inmobiliaria'];
}
