/**
 * Catálogo de permisos.
 *
 * Un rol es una lista de permisos. Los cuatro roles de siempre (admin_lucuma, gerente, asesor,
 * solo_lectura) son listas fijas; cada organización puede crear los suyos marcando casillas
 * (Ajustes → Roles). El servidor decide con `permissions`, nunca con el nombre del rol: así un
 * «Jefe de ventas» creado por Bastión manda lo mismo que un gerente si tiene las mismas casillas.
 *
 * Granularidad a propósito gruesa: pocos permisos que un gerente entiende leyendo, no cuarenta.
 */
export const PERMISOS = [
    {
        id: 'leads.ver_todos',
        grupo: 'Leads',
        nombre: 'Ver los leads de todo el equipo',
        detalle: 'Sin este permiso solo ve los leads que tiene asignados.',
    },
    {
        id: 'leads.editar',
        grupo: 'Leads',
        nombre: 'Trabajar leads',
        detalle: 'Crear leads, registrar actividades, mover de etapa, calificar interés, escribir por WhatsApp, notas de voz.',
    },
    {
        id: 'leads.reasignar',
        grupo: 'Leads',
        nombre: 'Reasignar leads a otro asesor',
        detalle: 'Cambiar el asesor de un lead.',
    },
    {
        id: 'leads.exportar',
        grupo: 'Leads',
        nombre: 'Exportar leads a CSV',
        detalle: 'Descarga masiva de datos personales: queda en auditoría.',
    },
    {
        id: 'leads.borrar',
        grupo: 'Leads',
        nombre: 'Borrar leads',
        detalle: 'Eliminar leads para siempre (pruebas, duplicados, pedidos de baja). No se puede deshacer; queda en auditoría.',
    },
    {
        id: 'reportes.ver',
        grupo: 'Reportes',
        nombre: 'Ver reportes',
        detalle: 'Resumen y reportes del embudo.',
    },
    {
        id: 'inventario.editar',
        grupo: 'Inventario',
        nombre: 'Editar proyectos, tipologías y unidades',
        detalle: 'Crear y editar inventario, cambiar estados (disponible, reservado, vendido), importar CSV. No incluye precios.',
    },
    {
        id: 'inventario.precios',
        grupo: 'Inventario',
        nombre: 'Cambiar precios de lista',
        detalle: 'Precio de unidades y precio desde de tipologías. Cada cambio queda en auditoría.',
    },
    {
        id: 'embudo.configurar',
        grupo: 'Configuración',
        nombre: 'Configurar el embudo',
        detalle: 'Etapas, motivos de pérdida, niveles de interés y descuento máximo de la organización.',
    },
    {
        id: 'usuarios.gestionar',
        grupo: 'Configuración',
        nombre: 'Gestionar usuarios y roles',
        detalle: 'Crear usuarios, asignar roles, descuento máximo por usuario, crear roles.',
    },
    {
        id: 'canales.configurar',
        grupo: 'Configuración',
        nombre: 'Configurar canales',
        detalle: 'Sitios web y formularios, Meta Lead Ads, números de WhatsApp.',
    },
    {
        id: 'respaldos.descargar',
        grupo: 'Configuración',
        nombre: 'Descargar respaldos',
        detalle: 'Ver el estado de los respaldos y descargar una copia completa de la información (leads, conversaciones, proformas, archivos). Queda en auditoría.',
    },
    {
        id: 'registro.ver',
        grupo: 'Configuración',
        nombre: 'Ver el registro técnico',
        detalle: 'Logs del servidor. Normalmente solo Lucuma.',
    },
];
export const PERMISOS_IDS = PERMISOS.map((p) => p.id);
export const ROLES_BASE = {
    admin_lucuma: { nombre: 'Admin Lucuma', permisos: [...PERMISOS_IDS] },
    gerente: {
        nombre: 'Gerente',
        permisos: PERMISOS_IDS.filter((p) => p !== 'registro.ver'),
    },
    asesor: {
        nombre: 'Asesor',
        permisos: ['leads.editar', 'reportes.ver'],
    },
    solo_lectura: {
        nombre: 'Solo lectura',
        permisos: ['leads.ver_todos', 'reportes.ver'],
    },
};
/**
 * La cuenta de Lucuma dentro de cada CRM.
 *
 * Es la puerta de Lucuma en las organizaciones de sus clientes y el gerente en la de Lucuma.
 * Nadie puede desactivarla, cambiarle el rol ni la contraseña desde el panel, y solo ella ve
 * las vistas internas (facturación y cobranza de Lucuma, herramientas de soporte). Se crea
 * desde el servidor (`npm run admin:prod`); el panel no deja crear un usuario con este correo,
 * porque un gerente que lo hiciera en su organización se daría a sí mismo esas vistas.
 */
export const CUENTA_LUCUMA = 'dev@lucumaagency.com';
export function esCuentaLucuma(email) {
    return (email ?? '').trim().toLowerCase() === CUENTA_LUCUMA;
}
export function esPermiso(x) {
    return PERMISOS_IDS.includes(x);
}
