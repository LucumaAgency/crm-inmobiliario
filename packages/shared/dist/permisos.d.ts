/**
 * Catálogo de permisos.
 *
 * Un rol es una lista de permisos. Los cuatro roles de siempre (admin_lucuma, gerente, asesor,
 * solo_lectura) son listas fijas; cada organización puede crear los suyos marcando casillas
 * (Ajustes → Roles). El servidor decide con `permissions`, nunca con el nombre del rol: así un
 * «Jefe de ventas» creado por Bastión manda lo mismo que un gerente si tiene las mismas casillas.
 *
 * Granularidad a propósito gruesa: once permisos que un gerente entiende leyendo, no cuarenta.
 */
export declare const PERMISOS: readonly [{
    readonly id: "leads.ver_todos";
    readonly grupo: "Leads";
    readonly nombre: "Ver los leads de todo el equipo";
    readonly detalle: "Sin este permiso solo ve los leads que tiene asignados.";
}, {
    readonly id: "leads.editar";
    readonly grupo: "Leads";
    readonly nombre: "Trabajar leads";
    readonly detalle: "Crear leads, registrar actividades, mover de etapa, calificar interés, escribir por WhatsApp, notas de voz.";
}, {
    readonly id: "leads.reasignar";
    readonly grupo: "Leads";
    readonly nombre: "Reasignar leads a otro asesor";
    readonly detalle: "Cambiar el asesor de un lead.";
}, {
    readonly id: "leads.exportar";
    readonly grupo: "Leads";
    readonly nombre: "Exportar leads a CSV";
    readonly detalle: "Descarga masiva de datos personales: queda en auditoría.";
}, {
    readonly id: "reportes.ver";
    readonly grupo: "Reportes";
    readonly nombre: "Ver reportes";
    readonly detalle: "Resumen y reportes del embudo.";
}, {
    readonly id: "inventario.editar";
    readonly grupo: "Inventario";
    readonly nombre: "Editar proyectos, tipologías y unidades";
    readonly detalle: "Crear y editar inventario, cambiar estados (disponible, reservado, vendido), importar CSV. No incluye precios.";
}, {
    readonly id: "inventario.precios";
    readonly grupo: "Inventario";
    readonly nombre: "Cambiar precios de lista";
    readonly detalle: "Precio de unidades y precio desde de tipologías. Cada cambio queda en auditoría.";
}, {
    readonly id: "embudo.configurar";
    readonly grupo: "Configuración";
    readonly nombre: "Configurar el embudo";
    readonly detalle: "Etapas, motivos de pérdida, niveles de interés y descuento máximo de la organización.";
}, {
    readonly id: "usuarios.gestionar";
    readonly grupo: "Configuración";
    readonly nombre: "Gestionar usuarios y roles";
    readonly detalle: "Crear usuarios, asignar roles, descuento máximo por usuario, crear roles.";
}, {
    readonly id: "canales.configurar";
    readonly grupo: "Configuración";
    readonly nombre: "Configurar canales";
    readonly detalle: "Sitios web y formularios, Meta Lead Ads, números de WhatsApp.";
}, {
    readonly id: "registro.ver";
    readonly grupo: "Configuración";
    readonly nombre: "Ver el registro técnico";
    readonly detalle: "Logs del servidor. Normalmente solo Lucuma.";
}];
export type Permiso = (typeof PERMISOS)[number]['id'];
export declare const PERMISOS_IDS: Permiso[];
export type RolBase = 'admin_lucuma' | 'gerente' | 'asesor' | 'solo_lectura';
export declare const ROLES_BASE: Record<RolBase, {
    nombre: string;
    permisos: Permiso[];
}>;
export declare function esPermiso(x: string): x is Permiso;
