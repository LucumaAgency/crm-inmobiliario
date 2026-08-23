import 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirnameEnv = path.dirname(fileURLToPath(import.meta.url));
// El cliente de Prisma lee .env por su cuenta, pero el proceso no: sin esto `APP_URL`,
// `JWT_SECRET` y las de SMTP caían a sus valores por defecto aunque el .env las definiera.
//
// La ruta es EXPLÍCITA y relativa a este archivo, no al directorio actual: `loadEnvFile()`
// sin argumento busca en el cwd, y la tarea programada que ejecuta el worker no corre
// necesariamente desde la raíz de la aplicación. Con el cwd equivocado el worker arrancaría
// sin DATABASE_URL y moriría en cada ejecución, en silencio.
//
// Las variables ya presentes en el entorno GANAN sobre el archivo (comprobado), así que en
// Plesk el panel sigue mandando y el .env solo rellena lo que falte.
const rutaEnv = path.resolve(__dirnameEnv, '../../../.env');
try {
    process.loadEnvFile?.(rutaEnv);
}
catch {
    /* sin .env: se usan las variables del entorno, que es el caso de Passenger en Plesk */
}
const enProduccion = (process.env.NODE_ENV ?? 'development') === 'production';
function req(name, fallback) {
    const v = process.env[name] ?? fallback;
    if (v === undefined)
        throw new Error(`Falta la variable de entorno ${name}`);
    return v;
}
/**
 * Como `req`, pero en producción no acepta el valor por defecto.
 *
 * Un secreto de desarrollo que sobrevive al despliegue no rompe nada visible: la app
 * arranca, las sesiones funcionan, y quien lea el repo puede firmarse una sesión de
 * administrador. Es preferible que el proceso no levante.
 */
function reqEnProduccion(name, fallbackDev) {
    const v = process.env[name];
    if (v)
        return v;
    if (enProduccion) {
        throw new Error(`Falta la variable de entorno ${name}. Es obligatoria con NODE_ENV=production: ` +
            `el valor por defecto es público y solo sirve para desarrollo.`);
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
