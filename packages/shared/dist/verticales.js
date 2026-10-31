export const VERTICALES = ['inmobiliaria', 'agencia', 'clinica'];
export const ETIQUETAS = {
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
export function esVertical(x) {
    return VERTICALES.includes(x);
}
export function etiquetas(v) {
    return ETIQUETAS[v && esVertical(v) ? v : 'inmobiliaria'];
}
// ---------------------------------------------------------------- clínica
/**
 * Slug de la etapa «Derivado a clínica». El slug no cambia al renombrar la etapa, así que es
 * lo que identifica el paso en el que se pide la sede.
 */
export const ETAPA_DERIVADO = 'derivado-a-clinica';
/**
 * Orígenes que cuentan como «llegó por los canales de Lucuma» para el cobro por paciente
 * (docs/29 §6): formulario web, WhatsApp, Meta y la llamada que entra por Google/la web.
 * Los demás orígenes del alta manual (referido, clínica, ya era paciente, otro) no cuentan.
 */
export const ORIGENES_PROPIOS = ['web_form', 'whatsapp', 'meta_ads', 'llamada'];
/** Opciones de «¿Cómo llegó?» en el alta manual de una clínica. */
export const ORIGENES_MANUALES_CLINICA = [
    { valor: 'llamada', texto: 'Llamó desde Google o la web' },
    { valor: 'referido', texto: 'Referido por un colega o paciente' },
    { valor: 'clinica', texto: 'Derivado por la clínica' },
    { valor: 'paciente', texto: 'Ya era su paciente' },
    { valor: 'manual', texto: 'Otro' },
];
export function esOrigenPropio(source) {
    return ORIGENES_PROPIOS.includes(source ?? '');
}
/**
 * Paciente cobrable (S/ 100 por paciente, docs/29 §6): llegó por canales de Lucuma, está
 * atendido y el procedimiento que se le hizo es una cirugía.
 */
export function esCobrableClinica(l) {
    return !!l.wonAt && esOrigenPropio(l.source) && !!l.procedure?.extra?.cirugia;
}
