# Contrato de la API pública (para el conector de WordPress)

Todo bajo `/api/v1/public`. Es lo único que el plugin necesita conocer.

## Autenticación

| Cabecera | Llave | Para qué |
|---|---|---|
| `X-LCRM-Key` | **public key** (`pk_…`) | leer el esquema de un formulario, listar unidades, **enviar submissions** |
| `X-LCRM-Secret` | **secret key** (`sk_…`) | listar formularios (selector del elemento de Bricks) |

La public key viaja en el HTML a propósito: lo que la protege es la **lista blanca de dominios**
del sitio, verificada contra `Origin` o `Referer`. Una petición sin `Origin` (el proxy server
side del plugin) se acepta; ahí el tope es el rate limit.

La secret key **nunca** debe salir al navegador. Se guarda en las opciones de WordPress y se
puede rotar desde el CRM sin reinstalar el plugin.

## `GET /forms/:id` — esquema del formulario

Devuelve la definición y las **opciones dinámicas ya resueltas**, para que el plugin no tenga
que hacer una segunda llamada ni conocer el modelo de unidades.

```jsonc
{
  "id": "clx…",
  "version": 7,
  "schema": {
    "name": "Contacto Domus",
    "submitLabel": "Quiero más información",
    "fields": [
      { "key": "fname", "semantic": "fname", "type": "text", "label": "Nombre", "required": true },
      { "key": "unidad", "semantic": "unit_interest", "type": "select", "label": "Tipología",
        "source": { "type": "units", "onlyAvailable": true, "excludeKinds": ["estacionamiento","deposito"] } }
    ],
    "consent": { "required": true, "version": "2026-08", "text": "Autorizo el tratamiento…" },
    "antispam": { "honeypot": true, "minSeconds": 3, "turnstile": false },
    "success": { "type": "message", "value": "Gracias. Un asesor te contactará hoy mismo." }
  },
  "dynamicOptions": {
    "unidad": [ { "value": "clx…", "label": "302 · 3 dorm · 71.62 m²" } ]
  }
}
```

Responde con `ETag: W/"<id>-<version>"`. El plugin cachea por `id + version` en un transient y
**guarda además una copia persistente**: si el CRM no responde, el formulario se dibuja con la
última versión buena en lugar de desaparecer.

**No hay mapeo de campos.** `semantic` dice qué es cada campo. El plugin solo renderiza.

## `POST /forms/:id/submissions` — envío

Requiere `X-LCRM-Key`. Cuerpo:

```jsonc
{
  "idempotencyKey": "uuid-v4-generado-en-el-navegador",
  "values": { "fname": "Ana", "phone": "987654321", "email": "ana@…", "unidad": "clx…" },
  "consent": { "accepted": true, "version": "2026-08" },
  "attribution": {
    "first": { "utm_source": "facebook", "utm_campaign": "domus-agosto" },
    "last":  { "utm_source": "google" },
    "gclid": "…", "referrer": "…", "landingPage": "…", "pageUrl": "…", "pageTitle": "…"
  },
  "antispam": { "honeypot": "", "elapsedSeconds": 24 }
}
```

Respuesta `200`:

```json
{ "ok": true, "leadId": "clx…", "duplicated": false,
  "success": { "type": "message", "value": "Gracias…" } }
```

Reglas que implementa el servidor:

- **Idempotencia**: la misma `idempotencyKey` devuelve el resultado anterior sin crear nada.
  El plugin **debe reusar la misma clave en cada reintento de su cola**.
- **Deduplicación**: mismo contacto y mismo proyecto dentro de 30 días es una actividad nueva
  sobre el lead existente (`duplicated: true`), no un lead nuevo.
- **Consentimiento** obligatorio si el esquema lo exige (Ley 29733). Se guarda qué versión
  del texto se aceptó.
- **Antispam**: honeypot y time trap. El lead se marca como spam, no se descarta.
- **Payload crudo** guardado íntegro: si el mapeo cambia o falla, el original sobrevive.

Errores: `400` datos inválidos o falta un obligatorio · `401` llave o dominio no autorizado ·
`404` formulario inexistente · `429` rate limit.

**El plugin trata cualquier fallo distinto de `400` como "encolar y reintentar"**, muestra el
mensaje de éxito al visitante y envía igual su email de respaldo.

## `GET /forms` — lista de formularios

Requiere `X-LCRM-Secret`. Alimenta el selector del elemento de Bricks para no escribir IDs a mano.

```json
{ "forms": [ { "id": "clx…", "name": "Contacto Domus", "version": 7, "projectId": "clx…" } ] }
```

## `GET /units?projectId=…` — unidades

Public o secret key. Para el select dinámico y para mostrar disponibilidad y precios en la web
sin que nadie edite la página cuando se vende un departamento.

## Rate limit

60 peticiones por minuto por IP en `/public`. Un formulario legítimo nunca se acerca.
