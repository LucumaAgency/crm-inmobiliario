# Meta Lead Ads

Los formularios instantáneos de Facebook e Instagram entran al CRM como cualquier otro
lead: misma deduplicación, misma asignación por round robin, mismo aviso por correo. Este
documento es lo que hay que hacer una vez en Meta y una vez por cliente.

## Cómo funciona

El aviso de Meta **no trae los datos del lead**, solo un `leadgen_id`. Son dos pasos:

1. Meta llama a `POST /api/v1/meta/webhook`. El CRM comprueba la firma, registra el aviso
   y responde 200. Nada más: Meta exige respuesta en pocos segundos y, si no la recibe
   varias veces, **desactiva la suscripción de la aplicación entera** — es decir, dejaría
   sin leads a todos los clientes a la vez, no solo al que falló.
2. Un job (`meta.lead.fetch`) va al Graph API con el token de la página, trae los datos y
   entra por `captureLead()`, la misma puerta que el formulario web.

La URL del webhook es **una sola para toda la instalación**: Meta no admite una por
cliente. La organización se deduce del `page_id` del aviso, no del subdominio. Por eso una
página de Facebook solo puede estar conectada a un cliente.

## Configuración en Meta (una vez)

En [developers.facebook.com](https://developers.facebook.com), sobre la app de la agencia:

1. Añadir el producto **Webhooks** y suscribir el objeto **Page** al campo `leadgen`.
2. URL de devolución de llamada: `https://<dominio del CRM>/api/v1/meta/webhook`.
   Sirve el dominio raíz; no hace falta uno por cliente.
3. Token de verificación: el mismo valor que `META_VERIFY_TOKEN`.
   Meta hace un `GET` al guardar; si responde 403, el token no coincide.
4. Copiar el **App Secret** a `META_APP_SECRET`.
5. Permisos necesarios sobre la página del cliente: `leads_retrieval`, `pages_show_list` y
   `pages_manage_metadata`. Fuera de modo de desarrollo, Meta los revisa (*App Review*):
   conviene empezarlo con tiempo, tarda días.

> **Activar `appsecret_proof`** en la configuración avanzada de la app. El CRM ya lo envía
> en cada llamada; con la opción activada, un token robado no sirve fuera de aquí.

## Conectar un cliente

En el CRM, **Ajustes → Meta Lead Ads**:

1. ID de la página, nombre y **page access token** de esa página.
   El token se guarda cifrado (AES-256-GCM) y no se vuelve a mostrar: solo sus últimos
   cuatro caracteres, para saber cuál está cargado.
2. **Probar conexión**: confirma que el token vive y lista los formularios instantáneos de
   la página.
3. Asignar cada formulario a su proyecto. Lo que se deje sin asignar usa el proyecto por
   defecto de la página.
4. Correos de aviso de lead nuevo, igual que en un formulario web.

Usar un **token de larga duración** de la página. El de sesión caduca en horas y el canal
se queda mudo sin avisar: el webhook sigue llegando, los avisos quedan en `recibido` y
ningún lead entra. Eso es justamente lo que muestra la lista de últimos avisos.

## Qué se mapea

| Campo de Meta | En el CRM |
|---|---|
| `first_name` / `last_name` | nombre y apellido |
| `full_name` | se parte a la peruana: las dos últimas palabras son los apellidos |
| `email` | correo, normalizado |
| `phone_number` | teléfono, normalizado a E.164 |
| `dni`, `id_number`, `national_id`, `documento` | documento (llave principal de identidad) |
| cualquier otra pregunta | se anexa al mensaje del lead |

Nada se descarta: la respuesta completa del Graph API queda en `meta_leads.raw`.

El **consentimiento** lo recoge Meta dentro de Facebook o Instagram, no nosotros. Se deja
constancia de la procedencia y del `form_id`, que es lo que hay que poder mostrar ante un
reclamo bajo la Ley 29733.

## Las cuatro capas que hay que activar, y ninguna avisa

Conectar Lead Ads no es un paso, son cuatro, y **fallan todas en silencio**: Meta simplemente
no entrega y no hay error en ninguna parte. Se descubrió probándolo el 2026-09-21, y este es el
orden en que conviene comprobarlas.

1. **La app tiene que estar PUBLICADA.** Una app en desarrollo no recibe leadgen de producción.
   Esto es distinto de WhatsApp, que sí entrega sin publicar. El control está en el menú
   lateral del panel de la app, en **Publicar** —con la etiqueta «Sin publicar»—, no en un
   interruptor de la barra superior.

2. **El webhook suscrito al campo `leadgen`** del objeto **Page** (no User, que es el que sale
   por defecto). Guardar la URL y suscribir el campo son dos acciones separadas.

3. **La app suscrita a la página.** No tiene interfaz: es
   `POST /{page-id}/subscribed_apps` con `subscribed_fields=leadgen`, y requiere
   `leads_retrieval`. Se comprueba con un `GET` a esa misma ruta.

4. **El Lead Access Manager de la página.** Si la página lo tiene activado, ninguna app recibe
   leads hasta que se le concede acceso explícito, por muchos permisos que tenga. Es la capa
   que más despista porque todo lo demás sale en verde.

La **herramienta de pruebas** (`developers.facebook.com/tools/lead-ads-testing`) evalúa las
cuatro y las muestra con un diagnóstico por página y por app. Es el primer sitio al que ir
cuando un cliente diga que no le llegan los leads.

## El token que hay que pegar

El Explorador de la API Graph entrega por defecto un **token de usuario**, y cambiar el
desplegable a la página **no regenera el de arriba**: hay que volver a pulsar «Generate Access
Token» con la página ya seleccionada. Copiar el de usuario sin querer produce
`(#190) This method must be called with a Page Access Token`, que no dice qué hacer.

El CRM lo resuelve solo: acepta cualquiera de los dos y canjea el de página cuando hace falta.

Los tokens del Explorador **caducan en una o dos horas**. Para producción hay que usar un
**token de usuario del sistema** del portafolio empresarial, que no caduca.

## Diagnóstico

Estados de un aviso, en **Ajustes → Últimos avisos de Meta**:

| Estado | Qué pasó |
|---|---|
| `recibido` | llegó el aviso, falta traer los datos. Más de un minuto así = revisar el token |
| `procesado` | el lead está en el CRM (hay enlace a la ficha) |
| `fallido` | el Graph API rechazó la llamada. El motivo aparece en la fila |
| `descartado` | la página se desconectó entre el aviso y el procesado |

La **herramienta de pruebas de Lead Ads** de Meta permite generar un lead de prueba sin
gastar en anuncios. Un lead de prueba entra al CRM como uno real.

## Límite conocido

El reintento con backoff de un aviso fallido **necesita la tarea programada**, que hoy no
corre (ver `PROGRESO.md` §3). El primer intento sí sale en el momento, porque encolar algo
vencido dispara la cola en línea. Mientras tanto, un fallo transitorio del Graph API se
recupera con el botón **Reintentar** de esa pantalla.
