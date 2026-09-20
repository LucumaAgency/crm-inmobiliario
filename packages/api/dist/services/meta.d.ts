export interface AvisoLeadgen {
    leadgenId: string;
    pageId: string;
    formId?: string;
    adId?: string;
    adgroupId?: string;
    createdTime?: number;
}
/** Campo del formulario instantáneo tal como lo devuelve el Graph API. */
interface CampoMeta {
    name: string;
    values: string[];
}
/**
 * Registra el aviso y encola su procesado. Idempotente: el mismo `leadgen_id` dos veces
 * deja una sola fila y encola una sola vez.
 *
 * Devuelve `false` si el aviso se ignora (página desconocida o desactivada), para que el
 * webhook lo deje anotado en el log sin fallar: a Meta se le responde 200 igual, porque
 * un error nuestro repetido le hace desactivar la suscripción.
 */
export declare function registrarAviso(aviso: AvisoLeadgen): Promise<boolean>;
/**
 * Trae el lead de Meta y lo mete en el CRM. Lo llama la cola.
 *
 * Los fallos se propagan: la cola reintenta con backoff. Importa sobre todo para el token
 * vencido, que es el fallo típico de este canal y no se arregla solo — por eso queda
 * escrito en `lastError` de la página, para que se vea en el panel.
 */
export declare function procesarLeadgen(leadgenId: string): Promise<void>;
/**
 * Comprueba que el token de la página sigue vivo y lista sus formularios instantáneos.
 *
 * Los formularios se devuelven para poder armar el `formMap` sin copiar identificadores
 * a mano desde el administrador de anuncios, que es donde se cometen las erratas que
 * luego mandan los leads al proyecto equivocado.
 */
export declare function probarPagina(pageId: string): Promise<{
    ok: boolean;
    error?: string;
    pageName?: string;
    forms?: Array<{
        id: string;
        name: string;
        status?: string;
    }>;
}>;
declare function mapear(campos: CampoMeta[]): {
    values: Record<string, string>;
};
/**
 * Parte el nombre completo en nombres y apellidos, a la peruana.
 *
 * Meta da `full_name` en un solo campo cuando el anunciante no pide nombre y apellido por
 * separado. Cortar por el primer espacio es lo obvio y es lo incorrecto aquí: «María
 * Elena Rojas Paz» dejaría a la señora como «María» de nombre y «Elena Rojas Paz» de
 * apellido, y el asesor la saluda mal en el primer mensaje de WhatsApp.
 *
 * En Perú se usan dos apellidos, así que desde tres palabras las dos últimas son los
 * apellidos y lo anterior son los nombres. Con dos palabras, uno y uno. No es infalible
 * —hay apellidos compuestos como «De la Cruz»—, pero acierta en la enorme mayoría y
 * falla mejor: deja el nombre de pila correcto, que es lo que se usa para saludar.
 */
export declare function partirNombre(completo: string): {
    fname: string;
    lname?: string;
};
/** El formulario instantáneo manda sobre el proyecto por defecto de la página. */
declare function proyectoDe(pagina: {
    projectId: string | null;
    formMap: unknown;
}, metaFormId: string | null): string | null;
/** Exportados para las pruebas del mapeo. */
export { mapear as _mapearCamposMeta, proyectoDe as _proyectoDe };
