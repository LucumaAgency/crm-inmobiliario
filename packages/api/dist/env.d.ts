import 'node:process';
export declare const env: {
    nodeEnv: string;
    port: number;
    appUrl: string;
    jwtSecret: string;
    cookieName: string;
    /**
     * Dominio base del CRM (`crmlucuma.com`). Cada cliente vive en su subdominio.
     * Sin definir, la aplicación funciona en modo de un solo cliente, como hasta ahora.
     */
    baseDomain: string;
    workerInline: boolean;
    smtp: {
        host: string | undefined;
        port: number;
        user: string | undefined;
        pass: string | undefined;
        from: string;
    };
    workerBatch: number;
    /**
     * Token del latido externo de la cola (`/api/v1/cron/tick`). Sin definir, la ruta
     * responde 503: una cola que cualquiera puede disparar es una forma gratis de hacer
     * trabajar al servidor.
     */
    cronToken: string;
    /**
     * Meta Lead Ads. Sin `appSecret` el webhook queda apagado: sin firma no hay forma de
     * distinguir un aviso de Meta de uno inventado, y este canal crea leads sin sesión.
     */
    meta: {
        appSecret: string;
        /** Cadena que Meta devuelve en el alta del webhook (hub.verify_token). */
        verifyToken: string;
        graphVersion: string;
    };
    /**
     * Notas de voz: OpenAI transcribe, Claude resume. Las dos son opcionales: sin la de
     * OpenAI la nota se guarda y avisa de que no se pudo transcribir; sin la de Anthropic
     * queda la transcripción sin propuesta. El SDK de Anthropic lee `ANTHROPIC_API_KEY`
     * por su cuenta; aquí solo se mira si existe.
     */
    voz: {
        openaiKey: string;
        modeloTranscripcion: string;
        claudeActivo: boolean;
        modeloResumen: string;
    };
    isProd: boolean;
};
