export const VERTICALES = ['inmobiliaria', 'agencia'];
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
export function esVertical(x) {
    return VERTICALES.includes(x);
}
export function etiquetas(v) {
    return ETIQUETAS[v && esVertical(v) ? v : 'inmobiliaria'];
}
