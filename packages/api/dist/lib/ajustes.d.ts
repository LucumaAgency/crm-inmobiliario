export interface AjustesOrg {
    /**
     * Transcribir las notas de voz con OpenAI y proponer la actividad con Claude.
     * Apagado por defecto: sin cuentas externas, sin costo y sin enviar audio fuera del país.
     */
    transcribirVoz: boolean;
}
export declare function leerAjustes(organizationId: string): Promise<AjustesOrg>;
export declare function guardarAjustes(organizationId: string, cambios: Partial<AjustesOrg>): Promise<AjustesOrg>;
