/**
 * Asignación en el momento de la captura. Un lead sin dueño es un lead perdido.
 * Fase 1: round robin entre los asesores activos de la organización.
 */
export declare function pickOwner(organizationId: string): Promise<string | null>;
export declare function assignLead(leadId: string, userId: string, reason?: string): Promise<void>;
