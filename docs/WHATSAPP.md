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
solo se puede escribir con una **plantilla aprobada** por Meta, y esa se paga. Meta cobra
por mensaje: las plantillas de servicio dentro de la ventana no se cobran, las de marketing
siempre sí. La tarifa de Perú está en el tarifario oficial de Meta, que se actualiza cada
trimestre.

Por eso `windowExpiresAt` es una columna y no un cálculo escondido: decide qué puede hacer
el asesor ahora mismo, y la ficha lo muestra como un estado, no como un error al enviar.

## Configuración en Meta

Sobre la misma app que ya usa Meta Lead Ads:

1. Añadir el producto **WhatsApp** y suscribir el webhook al campo `messages`.
   La URL es la misma: `https://<dominio del CRM>/api/v1/meta/webhook`.
2. Permisos: `whatsapp_business_messaging` y `whatsapp_business_management`.
3. Sacar el **phone number ID**, el **WABA ID** y un **token de larga duración**.
4. En el CRM, **Ajustes → WhatsApp**, conectar el número y probar la conexión.

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
- **No se descargan los archivos** que manda el cliente. El asesor ve que llegó una imagen
  y la abre desde el teléfono. Descargarlos exige almacenamiento y política de retención.
- **No hay bandeja compartida.** La conversación se atiende desde la ficha del lead, que es
  donde el asesor tiene el proyecto y la unidad a la vista. Si hiciera falta una bandeja
  multi-agente de verdad, sale más barato poner Chatwoot al lado que construirla.
- **No se puede escribir primero** a alguien que nunca escribió: WhatsApp no lo permite
  salvo con plantilla, y la conversación tiene que existir.
