import 'node:process';
export declare const env: {
    nodeEnv: string;
    port: number;
    appUrl: string;
    jwtSecret: string;
    cookieName: string;
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
