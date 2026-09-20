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
     * Meta Lead Ads. Sin `appSecret` el webhook queda apagado: sin firma no hay forma de
     * distinguir un aviso de Meta de uno inventado, y este canal crea leads sin sesión.
     */
    meta: {
        appSecret: string;
        /** Cadena que Meta devuelve en el alta del webhook (hub.verify_token). */
        verifyToken: string;
        graphVersion: string;
    };
    isProd: boolean;
};
