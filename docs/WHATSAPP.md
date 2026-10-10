# WhatsApp Cloud API

Los chats que abre el cliente entran al CRM como leads, con la campaña del anuncio si
vinieron de un Click-to-WhatsApp, y el asesor responde desde la ficha del lead.

## La decisión que hay que tomar antes de escribir una línea

Un número en la Cloud API **deja de funcionar en la app de WhatsApp del teléfono**. No es
un detalle de configuración: es lo que define si este canal sirve o estorba.

- Si el equipo atiende desde el **celular de cada asesor**, esos números no se pueden
  migrar sin quitárselos del teléfono. El CRM entonces trabaja con un **número comercial
  aparte**, y los chats personales de los asesores quedan fuera del sistema. Funciona,
  pero hay que acordar quién escribe por dónde: si nadie lo ordena, el cliente recibe un
  mensaje del número central y otro del celular del asesor.
- Si ya existe un **número central de ventas**, ese es el caso limpio: se migra y todo el
  canal queda dentro del CRM.

### Las tres formas de trabajar (lo que ve el cliente en Ajustes → WhatsApp)

La pregunta que hace todo cliente es «¿tengo que comprar un chip?». La respuesta depende
de cómo quiera trabajar, así que el panel lo muestra como una elección con el modo actual
marcado, no como un aviso (2026-10-01):

| Modo | Qué pasa | Qué requiere |
|---|---|---|
| **1 · Cada asesor desde su celular** | El CRM capta por web y Facebook; el asesor escribe desde su WhatsApp con el botón de la ficha. Se registra la actividad, no el chat. | Nada. Es el estado inicial de todo cliente. |
| **2 · Un número de la empresa en el CRM** | Número comercial (anuncios, web, letrero) cuyos chats entran como leads y se reparten. Los asesores conservan su WhatsApp personal para lo demás. | Un número **que no esté en ningún celular**: un chip nuevo, o el corporativo actual aceptando que deja de verse en la app y que el historial no se traslada. |
| **3 · Todo el WhatsApp desde el CRM** | Como la 2, pero el equipo deja la app por completo. | Pasar antes unos meses por la 2. |

Lo que **no existe** en ninguna plataforma: que el asesor siga chateando desde su celular y
el CRM vea esos chats. Meta no lo permite. Sperant tampoco lo tiene.

Secuencia comercial: el cliente entra en la 1 sin fricción. Cuando ve que los leads de web y
Facebook llegan solos, pregunta por WhatsApp, y la 2 se vende con el argumento de que el
número debe ser de la empresa y no del asesor que se va con sus contactos. El chip es un
detalle operativo de ese paso, no una condición para empezar.

### El número de prueba de Meta

Cada app recibe un número `+1 555…` para desarrollar. Solo escribe a cinco destinatarios
registrados a mano, nadie del público puede escribirle, no tiene perfil de empresa y Meta
puede retirarlo. Sirvió para probar el canal el 2026-09-20. El panel lo etiqueta «número
de prueba de Meta» y **no cuenta** como modo 2.

## Cómo funciona

Entra por el **mismo webhook** que Meta Lead Ads: Meta manda todos los avisos de una app a
una sola URL. Cambia el `object` del cuerpo (`whatsapp_business_account`) y la llave de
enrutado (`phone_number_id` en vez de `page_id`). La firma es la misma y el app secret
también.

Un mensaje entrante:

1. Busca el número conectado. Si no está o está pausado, se ignora y se responde 200.
2. Busca o crea el contacto **por teléfono normalizado**, la misma llave que usa el
   formulario web: quien escribió por la web y después por WhatsApp es una sola persona en
   el CRM, no dos.
3. Abre lead si el mensaje **viene de un anuncio** (`referral`) o si la conversación no
   tiene uno activo detrás. Si ya lo tiene, el mensaje es parte de la conversación y nada
   más: crear un lead por mensaje llenaría el embudo de duplicados y repartiría a la misma
   persona entre varios asesores.
4. Renueva la ventana de 24 horas.

## La ventana de 24 horas

Desde el último mensaje del cliente se puede responder **texto libre**. Pasado ese plazo,
solo se puede escribir con una **plantilla aprobada** por Meta, y esa se paga por mensaje
(detalle en «Qué se paga y qué no», más abajo).

Por eso `windowExpiresAt` es una columna y no un cálculo escondido: decide qué puede hacer
el asesor ahora mismo, y la ficha lo muestra como un estado, no como un error al enviar.

## Quién entra al CRM por este número

**Todo el que escriba al número conectado**, venga de donde venga. La captura no depende de
anuncios: el webhook recibe cualquier mensaje entrante y crea o actualiza el lead. Lo que
cambia según el origen es la **atribución**, no la captura:

| Origen | Qué llega | Fuente / atribución |
|---|---|---|
| Anuncio Click-to-WhatsApp | Mensaje con `referral` del anuncio | `whatsapp`, campaña y anuncio en `attribution` |
| Botón de la web, link `wa.me`, Instagram, ficha de Google | Mensaje normal | `whatsapp`, sin anuncio |
| Alguien que tenía el número guardado | Mensaje normal | `whatsapp`, sin anuncio |
| Persona que ya es lead | Mensaje normal | No crea otro lead: entra en su conversación y marca «sin leer» |

Dos consecuencias del chip dedicado:

- **El número deja de funcionar en la app de WhatsApp del celular.** Solo se atiende desde el
  CRM, en la ficha. Por eso la regla de no instalarlo nunca en la app (ver alta paso a paso).
- **Lo que sigue fuera del CRM** son los chats de los asesores en sus WhatsApp personales. El
  CRM solo ve lo que pasa por el número comercial.

## Qué se paga y qué no (al 2026-10-05)

Desde julio de 2025 Meta cobra **por mensaje entregado**, según la **categoría de la
plantilla** y el **país del destinatario**. Tarifas para Perú según terceros que replican el
tarifario de Meta (confirmar en el rate card oficial antes de presupuestar; el 2026-10-01
subieron utilidad y autenticación):

| Categoría | Qué es | USD por mensaje |
|---|---|---|
| Servicio | Responder dentro de las 24 h a quien escribió | **1.000 gratis al mes por número**, luego 0,02 a 0,03 |
| Utilidad | Recordatorio de visita, envío de cotización, confirmación de algo que la persona pidió | 0,02 a 0,03 |
| Autenticación | Códigos de verificación | 0,02 a 0,03 |
| Marketing | Primer acercamiento comercial, promociones, remarketing | 0,07 |

Lo que importa para el CRM:

- **Responder es gratis en la práctica.** 1.000 mensajes de servicio al mes no se agotan con
  30 o 40 leads mensuales.
- **Se paga cuando el CRM escribe primero** o cuando la ventana ya cerró: ahí va plantilla.
- **Caso Bastión** (30-40 leads al mes, unos 20 cargados a mano donde el asesor inicia):
  20 primeros mensajes × 0,03 a 0,07 = **USD 0,60 a 1,40 al mes**. El resto escribe primero
  y entra en servicio gratis. El costo no es tema; lo operativo sí (abajo).
- **Hace falta un método de pago** en el Administrador de WhatsApp aunque el gasto sea de un
  dólar: sin tarjeta Meta no deja enviar plantillas.
- **El botón «WhatsApp» de la ficha** (`wa.me` con saludo prearmado) sigue siendo gratis
  porque sale del celular del asesor, pero esa conversación queda fuera del CRM. Es el
  intercambio: centavos y todo en el CRM, o gratis y sin historial.

### Límites de envío (los «250»)

Aplican solo a **conversaciones que inicia la empresa** con plantilla, por usuarios únicos
cada 24 h. Las respuestas y los mensajes entrantes no cuentan.

- Nivel 0: **250** (arranque de un número nuevo o de un portafolio sin verificar).
- Nivel 1: 1.000 · Nivel 2: 10.000 · Nivel 3: 100.000 · Nivel 4: ilimitado.
- Se sube solo si la calidad del número es media o alta y se usa al menos la mitad del
  límite durante 7 días; Meta revisa cada 6 h.
- **Desde octubre de 2025 el límite es por portafolio de empresa, no por número**: más chips
  no multiplican la capacidad.

Con 20 inicios al mes, Bastión no se acerca al nivel 0. Solo pegaría con campañas masivas, y
ahí frena antes el costo por mensaje que el límite.

## Plantillas: qué son y cuáles hacen falta

Una plantilla es un mensaje prearmado que Meta **revisa y aprueba** antes de poder usarlo.
Es la única forma de escribirle primero a alguien por la API, o de retomar una conversación
con la ventana cerrada. Existe para frenar el spam.

Se redacta una vez con huecos que se rellenan por lead:

> Hola {{1}}, soy {{2}} de Bastión. Vimos tu interés en el proyecto {{3}} y me gustaría
> contarte sobre las opciones disponibles. ¿Te viene bien que conversemos?

El cliente recibe un mensaje normal, no nota que es plantilla. Si responde, se abre la
ventana de 24 h y el asesor escribe libre.

**Dónde y cuánto tarda.** Se crean en el Administrador de WhatsApp de Meta, en la WABA del
número conectado, con nombre, categoría e idioma. La aprobación suele tardar minutos u
horas. Rechazan las que parecen engañosas o cuya categoría no coincide con el texto. Meta
puede **recategorizar**: un «primer contacto» redactado como utilidad suele terminar en
marketing; da igual para el costo (centavos), pero conviene saberlo para no pelear la
categoría.

**Qué hace el CRM.** Lee las plantillas de la WABA en vivo (`message_templates` de Graph,
sin guardarlas) y las muestra en dos sitios:

- **Ajustes → WhatsApp → Plantillas de mensaje** (2026-10-05): tabla por número con nombre,
  categoría, idioma, estado (aprobada, en revisión, rechazada y el motivo), texto con sus
  variables y botones, y un enlace «Crear o editar en Meta» que abre el Administrador de
  WhatsApp de esa WABA. Solo lectura a propósito: crear o editar se hace en Meta.
- **La ficha del lead**, cuando la ventana de 24 h está cerrada: el campo de texto se cambia
  por un desplegable con las aprobadas y los huecos de las variables (`enviarPlantilla`).

No hay nada que programar para una plantilla nueva: se crea en Meta y aparece.

**Las tres para arrancar con un cliente:**

1. **Primer contacto a lead manual** (la de arriba). Probablemente marketing.
2. **Recordatorio de visita**: «Hola {{1}}, te recordamos tu visita a {{2}} el {{3}}. Si
   necesitas cambiarla, respóndenos por aquí.» Utilidad.
3. **Envío de cotización o plano**: «Hola {{1}}, te comparto la información del {{2}} que
   conversamos. Quedo atento a tus dudas.» Utilidad.

Hoy solo existe el número de prueba de Meta, así que **no hay plantillas propias**: crearlas
es parte del alta del número real (ver más abajo) y del onboarding de cada cliente.

**Lo operativo que sí hay que acordar con Bastión** antes de que sus 20 leads manuales pasen
por el CRM: esos primeros mensajes salen del número comercial y la respuesta llega al CRM, no
al celular del asesor. Es un cambio de hábito, no técnico.

## Configuración en Meta

Sobre la misma app que ya usa Meta Lead Ads:

1. Añadir el producto **WhatsApp** y suscribir el webhook al campo `messages`.
   La URL es la misma: `https://<dominio del CRM>/api/v1/meta/webhook`.
2. Permisos: `whatsapp_business_messaging` y `whatsapp_business_management`.
3. Sacar el **phone number ID**, el **WABA ID** y un **token de larga duración**.
4. En el CRM, **Ajustes → WhatsApp**, conectar el número y probar la conexión.

### Alta de un número real, paso a paso (hasta que exista el alta incrustada)

Hoy el alta la hacemos nosotros con el cliente en una llamada de unos 20 minutos. Cuando
seamos Tech Provider con Embedded Signup, el cliente pulsará «Conectar WhatsApp» y elegirá
su número en una ventana de Meta, como hoy con Facebook, y este formulario desaparece.

**Antes**: un número que no esté en ningún celular (si tuvo WhatsApp, eliminar la cuenta
desde la app primero) y el **nombre visible** decidido: Meta lo revisa en 1 o 2 días y debe
coincidir con la marca verificada.

1. Panel de la app → **WhatsApp → Configuración de la API → Agregar número de teléfono**.
   Elegir o crear la WABA del cliente; completar nombre visible, categoría y descripción.
2. Verificar el número con el código por SMS o llamada.
3. En esa pantalla, bajo el desplegable de números, copiar el **Identificador del número de
   teléfono** y el **Identificador de la cuenta de WhatsApp Business**.
4. Si queda «pendiente» o «sin registrar»: `POST /{phone_number_id}/register` con
   `{"messaging_product":"whatsapp","pin":"123456"}` (PIN propio de 6 dígitos, guardarlo).
5. **Suscribir la app a la WABA**: `POST /{WABA_ID}/subscribed_apps`. Es el paso que se
   olvida; sin él el número se conecta pero no llega ningún mensaje.
6. Método de pago en el Administrador de WhatsApp. Sin él Meta no deja enviar. Responder
   dentro de las 24 h es gratis; solo se cobran los mensajes iniciados con plantilla.
7. En el CRM, **Ajustes → WhatsApp → Conectar**: phone number ID, WABA ID, número como lo ve
   el cliente, token y proyecto por defecto (a dónde entran los chats que no vienen de un
   anuncio). Luego **Probar conexión**.
8. Escribir al número desde otro celular: debe aparecer un lead con el chat, y la respuesta
   desde la ficha tiene que llegar.

**El token**: hasta tener el usuario del sistema, el extendido de 60 días. Para WhatsApp no
hay canje que lo salve (a diferencia de Lead Ads, donde el token de página derivado no
vence): el día que venza hay que pegar otro. Anotar la fecha al conectar.

Usar siempre token de larga duración. El de sesión caduca en horas y el canal se queda
mudo: los mensajes entrantes se siguen guardando, pero los envíos fallan y el error queda
en la ficha del número.

## Qué se guarda

| Entrante | En el CRM |
|---|---|
| texto, botón, respuesta interactiva | cuerpo del mensaje |
| imagen, video, documento, audio | tipo y referencia del medio; **no se descarga el archivo** |
| ubicación | coordenadas |
| `referral` de un anuncio | atribución del lead: campaña, titular y `ctwa_clid` |

Los mensajes **no se registran como actividades del lead**. Llenarían el historial de
ruido y harían inútil la ficha; la conversación es su propio hilo y al lead solo suben los
hechos: entró por un anuncio, volvió a escribir.

Escribirle al cliente **sí cuenta como primer contacto** y cierra el SLA: sin eso, la
alerta de los 15 minutos saltaría sobre un asesor que ya respondió.

## Límites conocidos

- **Los reintentos de envío necesitan la tarea programada**, que hoy no corre (ver
  `PROGRESO.md` §3). El primer intento sale en el momento porque encolar algo vencido
  dispara la cola en línea; si Meta devuelve un 5xx, el reintento con espera no ocurre
  hasta que haya cron.
- **Archivos entrantes (desde 2026-10-10)**: imágenes, stickers, audios, videos y documentos
  se descargan de Meta en segundo plano (job `wa.media.fetch`) a `privados/<org>/wa/` y se
  ven en el chat de la ficha (imagen, sticker, reproductor de audio y video, enlace al
  documento, ubicación con enlace a Maps). Tope 16 MB; lo que no se pudo bajar queda con
  `media.error` y vuelve al aviso «se ve en el teléfono». Al abrir la ficha se reintentan los
  pendientes. Se sirven por `GET /leads/whatsapp/media/:id` con control de acceso. Los audios
  vienen en ogg/opus: Chrome y Firefox los reproducen, Safari en iPhone no (queda el enlace).
  Pendiente: política de retención para esta carpeta.
- **No hay bandeja compartida.** La conversación se atiende desde la ficha del lead, que es
  donde el asesor tiene el proyecto y la unidad a la vista. Si hiciera falta una bandeja
  multi-agente de verdad, sale más barato poner Chatwoot al lado que construirla.
- **No se puede escribir primero** a alguien que nunca escribió: WhatsApp no lo permite
  salvo con plantilla, y la conversación tiene que existir.
- **El refresco es por sondeo**, no por aviso del servidor: la lista se consulta cada 20 s y
  al volver a la pestaña, y el chat de la ficha cada 15 s. Con muchos asesores conectados
  conviene pasar a eventos del servidor.
