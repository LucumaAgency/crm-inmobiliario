# Despliegue en Plesk

Servidor de referencia: **MariaDB 10.6.22 (Ubuntu 22.04)**.

## 0. Antes de empezar

- El CRM va en su **propia suscripción de Plesk**, con su propio usuario de MySQL y su propio
  backup. No comparte espacio con los sitios de clientes: si una web se rompe, no puede caer
  con ella la captación de leads de todos.
- **Node 20 LTS.** Si la suscripción trae 21.7.3, cámbiala: la 21 es una versión impar ya sin
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
npm ci
npx prisma migrate deploy
npm run build
touch tmp/restart.txt
```

El SPA compilado (`packages/web/dist`) lo sirve el mismo proceso Fastify, así que solo hay una
aplicación que administrar.

## 4. Tarea programada (obligatoria)

**Passenger duerme la aplicación cuando no hay tráfico**, así que un `setInterval` dentro del
proceso no es confiable. La cola la procesa un worker externo:

Plesk → **Tareas programadas** → cada minuto:

```
/opt/plesk/node/20/bin/node /var/www/vhosts/<dominio>/crm/packages/api/dist/worker.js
```

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
