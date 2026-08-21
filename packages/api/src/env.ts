import 'node:process';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  appUrl: req('APP_URL', 'http://localhost:5173'),
  jwtSecret: req('JWT_SECRET', 'dev-secret-no-usar-en-produccion'),
  cookieName: process.env.COOKIE_NAME ?? 'lcrm_session',
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM ?? 'Lucuma CRM <no-reply@localhost>',
  },
  workerBatch: Number(process.env.WORKER_BATCH ?? 25),
  isProd: (process.env.NODE_ENV ?? 'development') === 'production',
};
