# Despliegue en Plesk

Servidor de referencia: **MariaDB 10.6.22 (Ubuntu 22.04)**.

## 0. Antes de empezar

- El CRM va en su **propia suscripción de Plesk**, con su propio usuario de MySQL y su propio
  backup. No comparte espacio con los sitios de clientes: si una web se rompe, no puede caer
  con ella la captación de leads de todos.
- **Node 20 LTS.** Hoy la suscripción trae 21.7.3, cámbiala: la 21 es una versión impar ya sin
  soporte de seguridad. Extensión Node.js → seleccionar versión.
- Subdominio de producción y otro de staging, ambos con SSL.

## 1. Base de datos

Crear base y usuario dedicados en Plesk. Cotejamiento `utf8mb4_unicode_ci`.

## 2. Aplicación

1. Plesk → **Node.js** → habilitar en el dominio.
2. Document root apuntando a la carpeta del repo.
3. **Application Startup File**: `packages/api/dist/server.js`
3b. **Raíz del documento**: `<dominio>/public` — **no** la raíz de la aplicación y **no**
   `packages/web/dist`.

   Passenger **ignora la "Raíz de la aplicación" que muestra Plesk** y deduce la suya como el
   *directorio padre del document root*. Con el docroot en `packages/web/dist` buscó el arranque
   en `packages/web/packages/api/dist/server.js` y falló con `MODULE_NOT_FOUND`, que en el
   navegador se ve como un genérico «Web application could not be started».

   Por eso el SPA se compila a `public/` en la raíz del repo (`packages/web/vite.config.ts`),
   y no dentro de su paquete: es la única disposición donde el docroot puede ser
   `<raíz>/public` y el archivo de arranque resolverse desde la raíz. De paso resuelve la
   advertencia de seguridad de Plesk, porque nginx solo publica el SPA compilado y nunca
   `package.json`, `prisma/` ni el código.
4. Variables de entorno (según `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `APP_URL`,
   `NODE_ENV=production`, `PORT`, y las de SMTP.

## 3. Despliegue: build en GitHub, pull en Plesk

**El servidor no compila.** GitHub Actions (`.github/workflows/build.yml`) corre en cada push
a `main`, genera el cliente de Prisma, verifica tipos, compila los tres paquetes y **commitea
los `dist/` de vuelta al repo**. Plesk solo hace pull de código ya construido. Es el mismo
patrón de `m2peru`, `scanner-inmobiliario-m2` y `valuador-app`.

Se gana lo de siempre: el deploy no depende de que el servidor tenga `typescript` ni `vite`, no
hay compilación que falle por memoria en una suscripción compartida, y lo que corre en Plesk es
exactamente el artefacto que CI verificó.

Git de Plesk apuntando a `main`, con estas acciones adicionales de despliegue:

```bash
npm ci --omit=dev             # solo dependencias de producción
npx prisma generate           # cliente tipado + motor binario de ESTE servidor
npx prisma migrate deploy     # aplica las migraciones versionadas
touch tmp/restart.txt
```

Dos cosas que sostienen ese bloque:

- **La CLI de `prisma` está en `dependencies`, no en `devDependencies`.** Tiene que sobrevivir
  al `--omit=dev` porque el servidor la necesita para `generate` y `migrate deploy`.
  `typescript`, `tsx` y `vite` sí quedan fuera: el servidor no los usa.
- **`prisma generate` corre siempre, y su salida nunca se commitea.** Descarga un motor binario
  propio del sistema operativo, así que el cliente generado en el runner de Ubuntu de GitHub no
  sirve necesariamente aquí. Por lo mismo, **nunca subas `node_modules` desde tu máquina**.
- **`migrate deploy` solo aplica migraciones que ya existen**, nunca las escribe. La inicial se
  genera en local con `npx prisma migrate dev --name init` y se commitea. Si
  `prisma/migrations/` estuviera vacío el comando terminaría con éxito dejando la base sin una
  sola tabla, y el seed del §5 fallaría después con un `table doesn't exist` difícil de
  interpretar.

El SPA compilado (`public/`) lo sirve también el proceso Fastify, para el fallback de
las rutas del dashboard; los estáticos los entrega nginx directo desde el docroot, así que solo hay una
aplicación que administrar.

### Verificado en simulacro

Este bloque se probó completo contra MariaDB 10.6.22 partiendo de una base vacía y de un
checkout limpio sin `node_modules`: `npm ci --omit=dev` deja la CLI de Prisma y no deja `tsc`,
`migrate deploy` crea las 15 tablas, el seed corre desde `dist` sin `tsx`, la API responde
`/api/health`, sirve el SPA, devuelve `401` en rutas protegidas sin sesión, y el worker termina
con código 0.

## 4. Tarea programada (obligatoria)

**Passenger duerme la aplicación cuando no hay tráfico**, así que un `setInterval` dentro del
proceso no es confiable. La cola la procesa un worker externo:

Plesk → **Tareas programadas** → cada minuto:

```
/opt/plesk/node/20/bin/node /var/www/vhosts/<dominio>/crm/packages/api/dist/worker.js
```

Esa ruta **depende de la versión de Node de la suscripción**: si sigue en 21.7.3 el binario de
`node/20` no existe y la tarea falla en silencio. Confirma la ruta real antes de darla por
buena, y revisa el log de la tarea programada al menos una vez después de crearla.

De esto dependen: los correos de lead nuevo, las alertas de SLA, los reintentos de webhooks y,
más adelante, las conversiones server side. Si no está activa, el CRM guarda leads pero no
avisa a nadie.

## 5. Primer arranque

```bash
npm run seed:prod
```

Corre desde `packages/api/dist/seed.js`, sin `tsx`: en el servidor no hay devDependencies.

Crea la organización, las etapas, el usuario admin y el sitio con sus llaves. **Anota la secret
key: se muestra una sola vez.** Después entra al CRM con magic link.

## 6. Verificación

- `GET /api/health` responde `{ ok: true }`.
- Se recibe el magic link y se entra.
- Un envío de prueba desde el sitio crea el lead y llega el correo.
- El mismo envío repetido con la misma `idempotencyKey` **no** crea un segundo lead.
- Un envío con la public key desde un dominio no autorizado devuelve `401`.

## 6b. Dónde ver los logs

La aplicación escribe en **`logs/app.log`**, en la raíz de la aplicación. Se abre desde el
Administrador de archivos de Plesk, igual que el `debug.log` de WordPress. Ahí van las
peticiones, los errores de la API y las líneas del worker.

Existe porque Passenger se queda con la salida estándar y la entierra en un log del servidor
incómodo de encontrar. El directorio está **fuera del document root** (que es `public/`), así
que nginx no lo publica.

Dos advertencias:

- **Sin SMTP configurado, los magic links se escriben en ese archivo.** Es la única forma de
  entrar mientras no haya correo, pero significa que cualquiera con acceso al archivo puede
  iniciar sesión como administrador. Es una muleta de puesta en marcha, no un estado
  aceptable: en cuanto SMTP funcione, esos enlaces dejan de escribirse solos.
- **No rota.** Crece hasta llenar el disco si nadie lo mira. Para producción con tráfico real,
  configurar `logrotate` sobre `logs/*.log` o vaciarlo periódicamente.

## 7. Operación

- Backup diario de la base, verificado con una restauración de prueba cada cierto tiempo.
- La exportación CSV siempre disponible para el cliente: anti lock-in deliberado.
- Sin datos personales en claro en los logs.
