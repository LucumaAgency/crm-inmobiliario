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

### Despliegue manual, mientras las acciones de Plesk no funcionen

Si las acciones adicionales fallan (por el PATH de Node, o porque el shell corre enjaulado),
hay que hacerlo a mano desde **Node.js → Run script**, y el orden importa:

| # | Paso | Qué toca |
|---|---|---|
| 1 | Desplegar desde Git | el código y `public/` |
| 2 | `prisma:generate` | **`node_modules`**: reescribe el cliente tipado |
| 3 | `prisma:deploy` | **la base**: aplica las migraciones |
| 4 | Reiniciar la aplicación | el proceso en memoria |

Los pasos 2 y 3 son distintos y hacen falta los dos. Saltarse el 2 tras añadir un modelo da un
`Cannot read properties of undefined` al usarlo, y un `Unknown field ... for include statement`
en las relaciones nuevas: el código pide algo que el cliente generado todavía no conoce.

Y saltarse el 4 deja el SPA nuevo hablando con la API vieja, que se ve como rutas que responden
«No encontrado» aunque existan en el código.

## 4. Tarea programada (obligatoria)

**Passenger duerme la aplicación cuando no hay tráfico**, así que un `setInterval` dentro del
proceso no es confiable. La cola la procesa un worker externo:

Plesk → **Tareas programadas** → cada minuto:

```
/var/www/vhosts/<hosting>/<dominio>/bin/worker.sh
```

Se usa el script del repo en vez de invocar `node` directamente porque **el shell de las tareas
programadas no hereda el PATH de Node de la suscripción**: un `node ...` a secas falla con
`command not found`, y en una tarea programada eso pasa en silencio, cada minuto, sin que nadie
se entere. `bin/worker.sh` busca el intérprete (prefiere 22 y 20 sobre la 21, que es impar y ya
no recibe parches), se sitúa en la raíz y ejecuta el worker.

Si hiciera falta fijar el intérprete: `NODE_BIN=/opt/plesk/node/20/bin/node .../bin/worker.sh`.

Probado ejecutándolo desde `/` y con el entorno vacío (`env -i`), que es el peor caso de un
cron: encuentra Node, carga el `.env` por ruta propia, conecta con la base y procesa la cola.
Revisa igual el log de la tarea la primera vez.

De esto dependen las alertas de SLA, los reintentos con espera y, más adelante, las
conversiones server side.

### Si el hosting no permite un cron por minuto

Hay servidores donde esto no se puede montar: las tareas programadas corren **enjauladas**
(la raíz es el home del usuario, sin `/opt/plesk` y a veces sin `dirname` ni `sort`), o el plan
de servicio limita la frecuencia mínima a una hora. Sacar la tarea de la jaula exige darle shell
real al usuario del sistema, y si esa suscripción aloja además los sitios de otros clientes, es
un riesgo que no compensa.

Hay dos salidas, y conviene tener las dos.

**1. El disparo en línea** (decisión 23). La API procesa la cola dentro de su propio proceso al
encolar un trabajo ya vencido, sin esperarlo (ver `services/cola.ts`). El aviso de lead nuevo
sale en segundos aunque no haya tarea programada.

No reemplaza al worker. Los trabajos **con espera** —una alerta de SLA a los 15 minutos, un
reintento con backoff— necesitan que alguien despierte la aplicación entonces, y de eso el
disparo en línea no puede encargarse: solo actúa cuando ya hay tráfico.

Se apaga con `WORKER_INLINE=0` donde la tarea programada sí funcione por minuto.

**2. El latido externo.** Es lo que cubre el hueco anterior. El problema de fondo no es el cron
sino que **Passenger duerme la aplicación sin tráfico**; una petición HTTP la despierta, así que
un cron de fuera llamando cada minuto hace el mismo trabajo que el worker local:

1. Generar un token largo y ponerlo en el `.env` como `CRON_TOKEN`.
   Sin ese valor la ruta responde 503: una cola que cualquiera puede disparar es una forma
   gratis de hacer trabajar al servidor.
2. Dar de alta en un servicio de cron externo, cada minuto:

   ```
   https://<dominio del CRM>/api/v1/cron/tick?token=<CRON_TOKEN>
   ```

   El token también se acepta en la cabecera `X-LCRM-Cron`, que es preferible cuando el
   servicio lo permite: no queda escrito en los registros de acceso del servidor.

La respuesta dice cuánto hizo: `{"ok":true,"jobs":3,"ms":412}`. Con `pendiente: true` quedó
trabajo para el siguiente latido, porque cada llamada se corta a los 25 segundos para no chocar
con el tiempo de espera del proxy. Nada se pierde: la cola está en la base.

Dos latidos solapados no se pisan —los trabajos se toman con bloqueo de fila— y el log solo
escribe cuando hubo trabajo: un latido por minuto serían 1.440 líneas diarias de «no había
nada», y un log que nadie puede leer es un log que no existe.

**Esto no sustituye a la suscripción propia** (decisión 18). Resuelve el SLA y los reintentos,
que es lo que hoy incumple lo que el producto promete. No resuelve el aislamiento respecto a los
72 dominios que comparten usuario del sistema con la base del CRM, ni el backup propio, y añade
una dependencia de un tercero.

## 4b. Correo saliente (SMTP)

Mientras `SMTP_HOST` no esté definido, la aplicación **no envía nada**: escribe los correos en
`logs/app.txt`, magic links incluidos. Sirve para arrancar, pero ningún asesor va a entrar así
y los avisos de lead nuevo no salen del servidor.

Con el correo de Plesk del propio dominio:

1. Plesk → **Correo** → crear una cuenta, por ejemplo `crm@<dominio>`.
2. Añadir estas variables **al `.env`**, no solo al panel de Node.js:

```
SMTP_HOST=mail.<dominio>
SMTP_PORT=465
SMTP_USER=crm@<dominio>
SMTP_PASS=la-contraseña-del-buzón
MAIL_FROM="Lucuma CRM <crm@<dominio>>"
```

Sustituye `<dominio>` por el real. Los `< >` solo se conservan en `MAIL_FROM`, donde forman
parte del formato estándar `Nombre <dirección>`.

**Puerto 465, no 587.** El transporte activa TLS directo solo cuando el puerto es 465; con 587
espera STARTTLS, y el servidor de correo de Plesk rechaza la conexión. Comprobado en el
despliegue de referencia: con 587 fallaba, con 465 y `mail.<dominio>` funciona.

`localhost` como host parece más simple y evita DNS, pero el certificado del servidor de correo
no coincide con ese nombre y la conexión TLS se cae. Usa el nombre real del servidor de correo.

Cuando algo no cuadre, el fallo completo queda en `logs/app.txt` con su código: `EDNS`/`EBADNAME`
es un host que no existe, `EAUTH` son credenciales, `ECONNREFUSED` es host o puerto, y un error
de certificado suele ser el host equivocado.

**Tienen que estar en el `.env`**, y esta es la razón: los correos de lead nuevo no los manda la
API, los manda el **worker**, que corre desde una tarea programada y por tanto **no recibe las
variables del panel de Node.js**. Si solo las pones ahí, el login por magic link funcionará y
las notificaciones de lead no, que es la peor combinación posible: parece que todo va bien.

Para entregabilidad real conviene una cuenta externa (Google Workspace, Zoho, un servicio
transaccional) en vez del correo del hosting, y configurar SPF y DKIM del dominio. Un correo de
lead nuevo que cae en spam equivale a no tenerlo.

## 5. Primer arranque

```bash
npm run seed:prod
```

Corre desde `packages/api/dist/seed.js`, sin `tsx`: en el servidor no hay devDependencies.

Crea la organización, las etapas, el usuario admin y el sitio con sus llaves. **Anota la secret
key: se muestra una sola vez.**

Después define la contraseña del admin, sin depender del correo:

```bash
npm run password:prod -- admin@lucuma.agency                 # genera una y la imprime una vez
npm run password:prod -- admin@lucuma.agency 'MiClave2026!'  # o la que tú elijas (mínimo 10)
npm run password:prod -- admin@lucuma.agency '' bastion      # si el correo está en varias organizaciones
npm run admin:prod -- correo@dominio.com 'SuClave2026' bastion  # CREA el admin si no existe
```

Es también la **puerta de emergencia** si el SMTP se cae: solo la tiene quien entra al servidor.
Desde **Node.js → Run script** se escribe `password:prod -- correo@dominio [clave] [slug]`, o
`admin:prod -- correo@dominio clave [slug]` para crear el admin si todavía no existe.

Cada usuario puede crear o cambiar la suya en **Mi cuenta** (pie del menú lateral). Quien aún no
tiene contraseña sigue entrando con el enlace al correo, que queda como respaldo.

## 6. Verificación

- `GET /api/health` responde `{ ok: true }`.
- Se entra con correo y contraseña; el enlace al correo también funciona.
- Un envío de prueba desde el sitio crea el lead y llega el correo.
- El mismo envío repetido con la misma `idempotencyKey` **no** crea un segundo lead.
- Un envío con la public key desde un dominio no autorizado devuelve `401`.

## 6b. Dónde ver los logs

La aplicación escribe en **`logs/app.txt`**, en la raíz de la aplicación. La extensión es
`.txt` y no `.log` porque el Administrador de archivos de Plesk no abre los `.log` en su
visor: obliga a descargarlos o renombrarlos. Se abre desde el
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
  configurar `logrotate` sobre `logs/*.txt` o vaciarlo periódicamente.

## 7. Operación

- Backup diario de la base, verificado con una restauración de prueba cada cierto tiempo.
- La exportación CSV siempre disponible para el cliente: anti lock-in deliberado.
- Sin datos personales en claro en los logs.
