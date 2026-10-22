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
    readonly id: "leads.borrar";
    readonly grupo: "Leads";
    readonly nombre: "Borrar leads";
    readonly detalle: "Eliminar leads para siempre (pruebas, duplicados, pedidos de baja). No se puede deshacer; queda en auditoría.";
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
    readonly id: "respaldos.descargar";
    readonly grupo: "Configuración";
    readonly nombre: "Descargar respaldos";
    readonly detalle: "Ver el estado de los respaldos y descargar una copia completa de la información (leads, conversaciones, proformas, archivos). Queda en auditoría.";
}, {
    readonly id: "clientes.gestionar";
    readonly grupo: "Clientes";
    readonly nombre: "Clientes y cobranza";
    readonly detalle: "Solo en agencias: clientes activos, servicios contratados, cobranza e ingresos.";
    readonly vertical: "agencia";
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
/**
 * La cuenta de Lucuma dentro de cada CRM.
 *
 * Es la puerta de Lucuma en las organizaciones de sus clientes y el gerente en la de Lucuma.
 * Nadie puede desactivarla, cambiarle el rol ni la contraseña desde el panel, y solo ella ve
 * las vistas internas (facturación y cobranza de Lucuma, herramientas de soporte). Se crea
 * desde el servidor (`npm run admin:prod`); el panel no deja crear un usuario con este correo,
 * porque un gerente que lo hiciera en su organización se daría a sí mismo esas vistas.
 */
export declare const CUENTA_LUCUMA = "dev@lucumaagency.com";
export declare function esCuentaLucuma(email: string | null | undefined): boolean;
/** La organización de Lucuma: ahí Clientes es solo de la cuenta de Lucuma, no de cualquier gerente. */
export declare const ORG_LUCUMA = "lucuma";
/**
 * Quién ve «Clientes» (cobranza de una agencia): solo en organizaciones agencia; en la de Lucuma,
 * solo la cuenta de Lucuma; en otra agencia (p. ej. Conecta), quien tenga `clientes.gestionar`
 * (el gerente) y la cuenta de Lucuma, que entra como soporte (ya ve todo lo demás).
 */
export declare function puedeVerClientes(o: {
    vertical: string | null | undefined;
    orgSlug: string;
    email: string;
    permissions: readonly string[];
}): boolean;
/**
 * Notas de voz (grabar en la ficha + transcripción): solo en el CRM de Lucuma. En las
 * organizaciones de clientes no se muestran ni se aceptan grabaciones nuevas.
 */
export declare function notasVozDisponibles(orgSlug: string | null | undefined): boolean;
export declare function esPermiso(x: string): x is Permiso;
