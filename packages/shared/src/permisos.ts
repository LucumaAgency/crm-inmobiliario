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
    id: 'clientes.gestionar',
    grupo: 'Clientes',
    nombre: 'Clientes y cobranza',
    detalle: 'Solo en agencias: clientes activos, servicios contratados, cobranza e ingresos.',
    vertical: 'agencia',
  },
  {
    id: 'registro.ver',
    grupo: 'Configuración',
    nombre: 'Ver el registro técnico',
    detalle: 'Logs del servidor. Normalmente solo Lucuma.',
  },
] as const;

export type Permiso = (typeof PERMISOS)[number]['id'];
export const PERMISOS_IDS: Permiso[] = PERMISOS.map((p) => p.id);

export type RolBase = 'admin_lucuma' | 'gerente' | 'asesor' | 'solo_lectura';

export const ROLES_BASE: Record<RolBase, { nombre: string; permisos: Permiso[] }> = {
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

export function esCuentaLucuma(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === CUENTA_LUCUMA;
}

/** La organización de Lucuma: ahí Clientes es solo de la cuenta de Lucuma, no de cualquier gerente. */
export const ORG_LUCUMA = 'lucuma';

/**
 * Quién ve «Clientes» (cobranza de una agencia): solo en organizaciones agencia; en la de Lucuma,
 * solo la cuenta de Lucuma; en otra agencia (p. ej. Conecta), quien tenga `clientes.gestionar`
 * (el gerente) y la cuenta de Lucuma, que entra como soporte (ya ve todo lo demás).
 */
export function puedeVerClientes(o: { vertical: string | null | undefined; orgSlug: string; email: string; permissions: readonly string[] }): boolean {
  if (o.vertical !== 'agencia') return false;
  if (o.orgSlug === ORG_LUCUMA) return esCuentaLucuma(o.email);
  return esCuentaLucuma(o.email) || o.permissions.includes('clientes.gestionar');
}

/**
 * Notas de voz (grabar en la ficha + transcripción): solo en el CRM de Lucuma. En las
 * organizaciones de clientes no se muestran ni se aceptan grabaciones nuevas.
 */
export function notasVozDisponibles(orgSlug: string | null | undefined): boolean {
  return orgSlug === ORG_LUCUMA;
}

/**
 * Organizaciones que migraron desde Sperant: solo en ellas tiene sentido filtrar por
 * «Importados de Sperant» / «Creados en el CRM».
 */
export const ORGS_SPERANT = ['bastion'];

export function usaSperant(orgSlug: string | null | undefined): boolean {
  return ORGS_SPERANT.includes(orgSlug ?? '');
}

export function esPermiso(x: string): x is Permiso {
  return (PERMISOS_IDS as string[]).includes(x);
}
