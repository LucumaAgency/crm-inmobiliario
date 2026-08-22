import 'node:process';

// El cliente de Prisma lee .env por su cuenta, pero el proceso no: sin esto `APP_URL`,
// `JWT_SECRET` y las de SMTP caían a sus valores por defecto aunque el .env las definiera.
// En Plesk las variables las inyecta el panel y este archivo no existe, de ahí el try.
try {
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.();
} catch {
  /* sin .env: se usan las variables del entorno, que es el caso de producción */
}

const enProduccion = (process.env.NODE_ENV ?? 'development') === 'production';

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/**
 * Como `req`, pero en producción no acepta el valor por defecto.
 *
 * Un secreto de desarrollo que sobrevive al despliegue no rompe nada visible: la app
 * arranca, las sesiones funcionan, y quien lea el repo puede firmarse una sesión de
 * administrador. Es preferible que el proceso no levante.
 */
function reqEnProduccion(name: string, fallbackDev: string): string {
  const v = process.env[name];
  if (v) return v;
  if (enProduccion) {
    throw new Error(
      `Falta la variable de entorno ${name}. Es obligatoria con NODE_ENV=production: ` +
        `el valor por defecto es público y solo sirve para desarrollo.`
    );
  }
  return fallbackDev;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  appUrl: reqEnProduccion('APP_URL', 'http://localhost:5173'),
  jwtSecret: reqEnProduccion('JWT_SECRET', 'dev-secret-no-usar-en-produccion'),
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
