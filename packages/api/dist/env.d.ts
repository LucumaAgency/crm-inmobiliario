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
    isProd: boolean;
};
