/**
 * Resolución del cliente (organización) a partir del subdominio.
 *
 * Modelo: una sola instalación sirve a todos los clientes, cada uno en su subdominio
 * (`bastion.crmlucuma.com`). El multi-tenant de los datos ya existía —`organizationId`
 * está en todas las tablas desde la primera migración—; lo que faltaba era la identidad
 * por URL.
 *
 * Por qué subdominio y no ruta (`/bastion`): cada subdominio es un **origen distinto**
 * para el navegador, así que las cookies y el almacenamiento local de un cliente son
 * inalcanzables desde el de otro. Con rutas, todos los clientes compartirían origen y el
 * aislamiento dependería por completo de que el código nunca se equivoque. Para datos
 * personales bajo Ley 29733, esa diferencia no se negocia.
 *
 * Si `CRM_BASE_DOMAIN` no está definido, la aplicación funciona en **modo de un solo
 * cliente**, exactamente como antes: es lo que mantiene vivo el despliegue actual sin
 * tocar nada.
 */
import type { FastifyRequest } from 'fastify';
export interface Tenant {
    id: string;
    name: string;
    slug: string;
}
declare module 'fastify' {
    interface FastifyRequest {
        /** Organización deducida del subdominio. `null` en modo de un solo cliente. */
        tenant?: Tenant | null;
    }
}
/**
 * Etiqueta del subdominio, o null si el host no cuelga del dominio base.
 *
 * `bastion.crmlucuma.com` → `bastion`
 * `crmlucuma.com`         → null (es la raíz, no un cliente)
 * `www.crmlucuma.com`     → null
 * `a.b.crmlucuma.com`     → null (no se admiten niveles extra)
 */
export declare function slugDesdeHost(host: string | undefined, base: string): string | null;
/** Busca la organización del subdominio, con caché corta. */
export declare function resolverTenant(host: string | undefined): Promise<Tenant | null>;
/** Olvida la caché de un slug. Para cuando se crea o renombra una organización. */
export declare function olvidarTenant(slug?: string): void;
/**
 * ¿La sesión pertenece al cliente de este subdominio?
 *
 * Es lo que impide que la cookie emitida en `bastion.` sirva en `proba.` si alguien la
 * copia a mano. Sin dominio base configurado (un solo cliente) siempre es válida.
 */
export declare function sesionCoincide(req: FastifyRequest, organizationId: string): boolean;
/**
 * URL base a la que debe volver el usuario, según desde dónde pidió.
 *
 * En modo de un solo cliente es `APP_URL`. Con varios, se reconstruye desde el host de la
 * petición: un enlace de acceso pedido en `bastion.` tiene que volver a `bastion.`, nunca
 * a la raíz ni al subdominio de otro cliente.
 */
export declare function baseUrlDePeticion(req: FastifyRequest): string;
/** URL del CRM de una organización, para los correos que envía el worker. */
export declare function urlDeOrganizacion(slug: string | null | undefined): string;
