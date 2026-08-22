# Lucuma CRM Inmobiliario

CRM inmobiliario de Lucuma Agency. **Plataforma independiente** (los asesores no entran a
WordPress) con una **API pública** que consume un conector nativo de WordPress.

Nace de la integración con Sperant en el proyecto Bastión: catálogos con IDs opacos, campos
personalizados sin endpoint, CORS bloqueado, y un mapeo frágil `form-field-xxxxx` que se rompía
cada vez que alguien tocaba el formulario. Aquí **el formulario se define en el CRM**, así que
no hay mapeo que romper.

> Estado: **Fase 1 en construcción.** Stack decidido, esquema y API operativos.

## Stack

Node 20 + TypeScript · Fastify · Prisma · **MariaDB 10.6 con columnas JSON** · React + Vite (SPA)
· TanStack Query. Sin Redis, sin Docker: corre sobre el Plesk que ya existe.

## Estructura

```
prisma/schema.prisma      modelo de datos (multi-tenant, contacto ≠ lead, jobs, auditoría)
packages/shared           tipos y esquemas Zod compartidos (definición de formulario, DTOs)
packages/api              Fastify + Prisma + worker de la cola
packages/web              SPA React, mobile first, para el equipo comercial
docs/CONECTOR-API.md      contrato de la API pública que implementa el plugin de WordPress
docs/DEPLOY-PLESK.md      puesta en producción sobre Plesk
```

El plugin de WordPress vive en su propio repositorio y consume `docs/CONECTOR-API.md`.

## Puesta en marcha (desarrollo)

```bash
cp .env.example .env          # ajusta DATABASE_URL y JWT_SECRET
npm install
npx prisma migrate dev --name init
npm run seed -w @lucuma-crm/api   # organización Bastión + proyecto Domus con sus 16 unidades
npm run dev                       # API en :3000, SPA en :5173
```

El seed imprime la **public key**, la **secret key** (solo esa vez) y el **form ID** para
configurar el plugin.

Sin SMTP configurado, los magic links se registran en la consola de la API en vez de enviarse.

## Qué hay implementado (Fase 1)

- **Captura de leads** con deduplicación (documento → email → teléfono), ventana de 30 días e
  **idempotencia**: el reintento de la cola del plugin nunca duplica un lead.
- **Formularios definidos en el CRM** con tipo semántico por campo y **opciones dinámicas**
  (el select de unidades se llena solo con lo disponible y se oculta lo vendido).
- **API pública** con dos llaves: pública restringida por dominio, secreta server side.
  CORS resuelto contra la lista blanca de cada sitio.
- **Asignación automática** round robin en el momento de la captura + **alerta de SLA** a los
  15 minutos sin primer contacto.
- **Actividades** con seguimiento agendado: no se cierra una sin agendar la siguiente.
- **Cola de trabajos** procesada por un worker que invoca una tarea programada de Plesk.
- **Consentimiento versionado** (Ley 29733) y **auditoría** de accesos y exportaciones.
- SPA mobile first: leads, ficha con WhatsApp y llamada directa, tareas del día, constructor de
  formularios, llaves de sitio, export CSV.

## Pendiente (Fase 2 y 3)

Kanban arrastrable, dashboard de embudo por fuente y campaña, webhooks salientes, WhatsApp
trackeado y Business API, Meta Lead Ads, conversiones server side a GA4 y Meta CAPI.

## Diseño

El razonamiento completo (arquitectura, seguridad, legal, roadmap) está en
`/home/claude-user/lucuma-crm-inmobiliario`, fuera de este repo.
