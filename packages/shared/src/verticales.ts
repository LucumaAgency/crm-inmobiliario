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

export const VERTICALES: Vertical[] = ['inmobiliaria', 'agencia', 'clinica'];

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
    usaCatalogo: false,
    usaDocumento: true,
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
    usaCatalogo: true,
    usaDocumento: true,
    ejemploProyecto: 'Posicionamiento SEO',
    ejemploUnidad: 'Crecimiento',
    visita: 'Reunión',
  },
  clinica: {
    vertical: 'Clínica',
    proyecto: 'Especialidad',
    proyectos: 'Especialidades',
    unidad: 'Procedimiento',
    unidades: 'Procedimientos',
    inventario: 'Procedimientos',
    documento: 'Presupuesto',
    documentos: 'Presupuestos',
    datosEmisor: 'Datos del consultorio',
    usaTipologias: false,
    usaStock: false,
    usaCatalogo: true,
    // Fuera de la versión 1: los honorarios dependen de la sede (docs/29 §9).
    usaDocumento: false,
    ejemploProyecto: 'Cirugía de tiroides',
    ejemploUnidad: 'Consulta',
    visita: 'Cita',
  },
};

export function esVertical(x: string): x is Vertical {
  return (VERTICALES as string[]).includes(x);
}

export function etiquetas(v: string | null | undefined): Etiquetas {
  return ETIQUETAS[v && esVertical(v) ? v : 'inmobiliaria'];
}

// ---------------------------------------------------------------- clínica

/**
 * Slug de la etapa «Derivado a clínica». El slug no cambia al renombrar la etapa, así que es
 * lo que identifica el paso en el que se pide la sede.
 */
export const ETAPA_DERIVADO = 'derivado-a-clinica';

/** Sede a la que el médico deriva pacientes (Ajustes → Sedes). */
// `type` y no `interface`: se guarda en un JSON de Prisma, que exige firma de índice.
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
export const ORIGENES_PROPIOS = ['web_form', 'whatsapp', 'meta_ads', 'llamada'] as const;

/** Opciones de «¿Cómo llegó?» en el alta manual de una clínica. */
export const ORIGENES_MANUALES_CLINICA: { valor: string; texto: string }[] = [
  { valor: 'llamada', texto: 'Llamó desde Google o la web' },
  { valor: 'referido', texto: 'Referido por un colega o paciente' },
  { valor: 'clinica', texto: 'Derivado por la clínica' },
  { valor: 'paciente', texto: 'Ya era su paciente' },
  { valor: 'manual', texto: 'Otro' },
];

export function esOrigenPropio(source: string | null | undefined): boolean {
  return (ORIGENES_PROPIOS as readonly string[]).includes(source ?? '');
}

/**
 * Paciente cobrable (S/ 100 por paciente, docs/29 §6): llegó por canales de Lucuma, está
 * atendido y el procedimiento que se le hizo es una cirugía.
 */
export function esCobrableClinica(l: { source: string; wonAt: Date | string | null; procedure: { extra: unknown } | null }): boolean {
  return !!l.wonAt && esOrigenPropio(l.source) && !!(l.procedure?.extra as { cirugia?: boolean } | null)?.cirugia;
}
