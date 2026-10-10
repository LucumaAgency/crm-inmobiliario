/**
 * Asignación en el momento de la captura. Un lead sin dueño es un lead perdido.
 * Fase 1: round robin entre los asesores activos de la organización.
 */
export declare function pickOwner(organizationId: string): Promise<string | null>;
/**
 * Asigna un lead a un asesor.
 *
 * La comprobación de que ambos son del mismo cliente va AQUÍ y no en la ruta, porque esta
 * función la llaman la captura, el round robin y la reasignación manual: en el borde se
 * olvida en alguna. Y lo que estaba en juego no era solo un dato descuadrado: el aviso de
 * lead nuevo se manda al correo del dueño, así que un `ownerId` de otra organización
 * recibía el nombre y el teléfono de una persona que no es suya (Ley 29733).
 */
export declare function assignLead(leadId: string, userId: string, reason?: string): Promise<void>;
