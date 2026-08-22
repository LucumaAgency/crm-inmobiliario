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
4. Variables de entorno (según `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `APP_URL`,
   `NODE_ENV=production`, `PORT`, y las de SMTP.

## 3. Despliegue

Git de Plesk apuntando a `main`, con este despliegue adicional:

```bash
npm ci --include=dev          # prisma CLI, typescript y vite viven en devDependencies
npx prisma generate           # escribe el cliente tipado dentro de node_modules
npx prisma migrate deploy     # aplica las migraciones versionadas en prisma/migrations
npm run build
touch tmp/restart.txt
```

Tres cosas que no son opcionales aquí:

- **`--include=dev`.** La aplicación corre con `NODE_ENV=production` (§2) y con esa variable
  `npm ci` omite las `devDependencies`. Ahí están `prisma`, `typescript` y `vite`: sin ellas
  `npx prisma` intenta descargarse en pleno deploy y `npm run build` no encuentra el compilador.
- **`prisma generate` explícito.** `@prisma/client` se instala vacío; `generate` es el paso que
  escribe el cliente real a partir de `prisma/schema.prisma`. Es compilación, corre en cada
  deploy. Descarga además un motor binario propio del sistema operativo del servidor, así que
  **nunca subas `node_modules` desde tu máquina**: el binario no sería el de Ubuntu.
- **`migrate deploy` solo aplica migraciones que ya existen**, nunca las escribe. Si
  `prisma/migrations/` está vacío el comando termina con éxito y deja la base sin una sola
  tabla; el seed del §5 falla después con un `table doesn't exist` difícil de interpretar.
  La migración inicial se genera en local con `npx prisma migrate dev --name init` y se
  commitea.

El SPA compilado (`packages/web/dist`) lo sirve el mismo proceso Fastify, así que solo hay una
aplicación que administrar.

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
npm run seed -w @lucuma-crm/api
```

Crea la organización, las etapas, el usuario admin y el sitio con sus llaves. **Anota la secret
key: se muestra una sola vez.** Después entra al CRM con magic link.

## 6. Verificación

- `GET /api/health` responde `{ ok: true }`.
- Se recibe el magic link y se entra.
- Un envío de prueba desde el sitio crea el lead y llega el correo.
- El mismo envío repetido con la misma `idempotencyKey` **no** crea un segundo lead.
- Un envío con la public key desde un dominio no autorizado devuelve `401`.

## 7. Operación

- Backup diario de la base, verificado con una restauración de prueba cada cierto tiempo.
- La exportación CSV siempre disponible para el cliente: anti lock-in deliberado.
- Sin datos personales en claro en los logs.
