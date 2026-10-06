export interface AjustesOrg {
    /**
     * Transcribir las notas de voz con OpenAI y proponer la actividad con Claude.
     * Apagado por defecto: sin cuentas externas, sin costo y sin enviar audio fuera del país.
     */
    transcribirVoz: boolean;
    /**
     * Motivos de pérdida que se ofrecen al mover un lead a una etapa perdida. El asesor elige
     * uno o escribe otro. Son por organización porque cada inmobiliaria pierde por razones
     * distintas (precio, financiamiento, zona, compró a la competencia...).
     */
    motivosPerdida: string[];
    /**
     * Descuento máximo (%) que puede ofrecer un asesor que no tenga uno propio. Null = sin
     * tope. Lo define el gerente; se aplica en la proforma.
     */
    descuentoMaximoPct: number | null;
}
export declare const MOTIVOS_PERDIDA_DEFECTO: string[];
export declare function leerAjustes(organizationId: string): Promise<AjustesOrg>;
export declare function guardarAjustes(organizationId: string, cambios: Partial<AjustesOrg>): Promise<AjustesOrg>;
