/**
 * Página puente del botón «Conectar WhatsApp», en `APP_URL/conectar-whatsapp`.
 *
 * HTML suelto a propósito, sin el SPA: tiene que abrir sin sesión (el dominio base no
 * tiene la cookie del cliente) y lo único que hace es cargar el SDK de Facebook, abrir el
 * registro de Meta y mandar el código al servidor. El pase llega en el fragmento
 * (`#pase=`) y se borra de la barra de direcciones apenas se lee.
 *
 * Detalles de Meta que este archivo respeta (docs de Embedded Signup, nov-2026):
 *  - El callback de `FB.login` NO puede ser `async`: el SDK lo rechaza.
 *  - El código vive 30 s: se manda al servidor en cuanto llega.
 *  - En coexistencia el evento `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` trae solo
 *    `waba_id`; el servidor resuelve el número.
 *  - La versión del flujo la fija la configuración (producto elegido ⇒ v4): no se manda
 *    `extras.version`.
 */
import type { FastifyInstance } from 'fastify';

const HTML = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Conectar WhatsApp · Lucuma CRM</title>
<style>
  :root { --azul:#174FCA; --texto:#1b1f24; --suave:#5b6470; --borde:#e3e6ea; --fondo:#f6f7f9; --error:#b42318; --ok:#067647; }
  * { box-sizing:border-box; }
  body { margin:0; font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:var(--texto); background:var(--fondo); }
  main { max-width:520px; margin:48px auto; padding:0 16px; }
  .card { background:#fff; border:1px solid var(--borde); border-radius:12px; padding:28px; }
  h1 { font-size:22px; margin:0 0 8px; }
  p { margin:8px 0; color:var(--suave); }
  ul { color:var(--suave); padding-left:20px; margin:8px 0; }
  strong { color:var(--texto); }
  button { margin-top:16px; width:100%; padding:14px; border:0; border-radius:8px; background:var(--azul); color:#fff; font:600 16px system-ui,sans-serif; cursor:pointer; }
  button[disabled] { opacity:.5; cursor:default; }
  .estado { margin-top:16px; font-weight:600; }
  .estado.error { color:var(--error); }
  .estado.ok { color:var(--ok); }
  a { color:var(--azul); }
  .oculto { display:none; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Conectar WhatsApp</h1>
    <p id="intro">Cargando…</p>
    <div id="coex" class="oculto">
      <p>Vas a conectar el número que usas en la app <strong>WhatsApp Business</strong>. Sigues usándolo en el celular y además sus chats entran al CRM. Antes de seguir:</p>
      <ul>
        <li>Ten a mano el celular con WhatsApp Business (versión 2.24.17 o más nueva): Meta te pedirá escanear un código QR desde la app.</li>
        <li>Se cerrarán WhatsApp Web y escritorio; luego puedes volver a vincularlos (WhatsApp para Windows no es compatible).</li>
        <li>Acepta compartir el historial cuando la app lo pregunte, así los chats de tus clientes llegan a sus fichas.</li>
      </ul>
    </div>
    <div id="nuevo" class="oculto">
      <p>Vas a conectar un número que vivirá <strong>solo en el CRM</strong>. Si hoy está en la app de WhatsApp de un celular, dejará de funcionar ahí.</p>
    </div>
    <button id="btn" disabled>Continuar con Facebook</button>
    <div id="estado" class="estado"></div>
  </div>
</main>
<script>
(function () {
  var pase = new URLSearchParams(location.hash.slice(1)).get('pase') || '';
  // Fuera de la barra de direcciones y del historial apenas se lee.
  history.replaceState(null, '', location.pathname);

  var btn = document.getElementById('btn');
  var estado = document.getElementById('estado');
  var info = null;
  var eventoMeta = null;
  var enviando = false;

  function mostrar(texto, clase) {
    estado.className = 'estado ' + (clase || '');
    estado.textContent = texto;
  }
  function volverCon(params) {
    if (!info || !info.volverA) return;
    var u = new URL('/ajustes', info.volverA);
    u.searchParams.set('seccion', 'whatsapp');
    Object.keys(params).forEach(function (k) { if (params[k] != null) u.searchParams.set(k, params[k]); });
    location.href = u.toString();
  }
  function post(ruta, cuerpo) {
    return fetch('/api/v1/whatsapp/alta/' + ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }); });
  }

  // Lo que Meta cuenta del flujo: WABA, número, o en qué paso se canceló.
  window.addEventListener('message', function (event) {
    if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
    var data;
    try { data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data; } catch (e) { return; }
    if (!data || data.type !== 'WA_EMBEDDED_SIGNUP') return;
    eventoMeta = data;
    if (data.event === 'CANCEL' || data.event === 'ERROR') {
      post('evento', { pase: pase, evento: data }).catch(function () {});
      if (data.event === 'ERROR') {
        mostrar('Meta devolvió un error: ' + ((data.data && data.data.error_message) || 'sin detalle') + '. Puedes volver a intentarlo.', 'error');
      }
    }
  });

  function completar(code) {
    if (enviando) return;
    enviando = true;
    btn.disabled = true;
    mostrar('Conectando el número con el CRM…');
    var d = (eventoMeta && eventoMeta.data) || {};
    post('completar', {
      pase: pase,
      code: code,
      evento: eventoMeta ? eventoMeta.event : undefined,
      wabaId: d.waba_id || undefined,
      phoneNumberId: d.phone_number_id || undefined,
    }).then(function (r) {
      if (r.ok) {
        mostrar('¡Listo! ' + r.numero + ' quedó conectado. Volviendo al CRM…', 'ok');
        setTimeout(function () {
          volverCon({ wa: 'ok', numero: r.numero, coex: r.coexistencia ? '1' : '0', avisos: (r.avisos || []).join(' | ') || null });
        }, 1500);
      } else {
        mostrar(r.error || 'No se pudo completar la conexión.', 'error');
        if (r.volverA) info.volverA = r.volverA;
        var a = document.createElement('p');
        a.innerHTML = '<a href="#">Volver al CRM</a>';
        a.firstChild.onclick = function (e) { e.preventDefault(); volverCon({ wa: 'error', detalle: r.error || '' }); };
        estado.appendChild(a);
      }
    }).catch(function () {
      enviando = false;
      btn.disabled = false;
      mostrar('Se cortó la conexión con el CRM. Vuelve a intentarlo.', 'error');
    });
  }

  // El callback no puede ser async (lo exige el SDK de Facebook).
  function alVolverDeMeta(response) {
    var code = response && response.authResponse && response.authResponse.code;
    if (!code) {
      btn.disabled = false;
      if (!eventoMeta || eventoMeta.event !== 'ERROR') mostrar('Se cerró la ventana de Meta antes de terminar. Puedes volver a intentarlo.', 'error');
      return;
    }
    // El evento con la cuenta y el número suele llegar antes que el código; si no, se le
    // da un momento (el código aguanta 30 s).
    if (eventoMeta) return completar(code);
    var espera = 0;
    var t = setInterval(function () {
      espera += 250;
      if (eventoMeta || espera >= 2000) { clearInterval(t); completar(code); }
    }, 250);
  }

  btn.addEventListener('click', function () {
    if (!window.FB || !info) return;
    btn.disabled = true;
    mostrar('');
    eventoMeta = null;
    var extras = { setup: {}, sessionInfoVersion: '3' };
    if (info.modo === 'coexistencia') extras.featureType = 'whatsapp_business_app_onboarding';
    FB.login(alVolverDeMeta, {
      config_id: info.configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: extras,
    });
  });

  if (!pase) {
    document.getElementById('intro').textContent = 'Este enlace no trae el permiso de conexión. Vuelve al CRM y pulsa «Conectar WhatsApp».';
    return;
  }

  post('info', { pase: pase }).then(function (r) {
    if (!r.appId) {
      document.getElementById('intro').textContent = r.error || 'El enlace venció. Vuelve al CRM y pulsa «Conectar WhatsApp» otra vez.';
      return;
    }
    info = r;
    document.getElementById('intro').innerHTML = 'Cuenta del CRM: <strong></strong>';
    document.querySelector('#intro strong').textContent = r.organizacion;
    document.getElementById(r.modo === 'coexistencia' ? 'coex' : 'nuevo').className = '';

    window.fbAsyncInit = function () {
      FB.init({ appId: r.appId, autoLogAppEvents: true, xfbml: false, version: r.graphVersion });
      btn.disabled = false;
    };
    var s = document.createElement('script');
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.src = 'https://connect.facebook.net/es_LA/sdk.js';
    s.onerror = function () { mostrar('No se pudo cargar Facebook. Revisa si un bloqueador de anuncios lo impide.', 'error'); };
    document.body.appendChild(s);
  }).catch(function () {
    document.getElementById('intro').textContent = 'No se pudo contactar al CRM. Recarga la página.';
  });
})();
</script>
</body>
</html>`;

export default async function paginaConectarWhatsApp(app: FastifyInstance) {
  app.get('/conectar-whatsapp', async (_req, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
      .type('text/html; charset=utf-8');
    return HTML;
  });
}
