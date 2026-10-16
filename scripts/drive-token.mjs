#!/usr/bin/env node
/**
 * Saca el token de actualización de Google Drive para los respaldos (una sola vez).
 *
 *   1) node scripts/drive-token.mjs <CLIENT_ID> <CLIENT_SECRET>
 *      Imprime un enlace. Ábrelo, entra con la cuenta de Google de Lucuma y acepta.
 *      Google te manda a http://127.0.0.1:53682/?code=... (la página no carga: es normal).
 *   2) node scripts/drive-token.mjs <CLIENT_ID> <CLIENT_SECRET> "<la URL completa de la barra>"
 *      Imprime GDRIVE_REFRESH_TOKEN para pegarlo en Plesk.
 *
 * El cliente de OAuth tiene que ser de tipo «App de escritorio», y la pantalla de
 * consentimiento debe estar PUBLICADA («En producción»): en modo «Prueba» Google vence el
 * token a los 7 días y los respaldos dejan de subir. `drive.file` no requiere verificación.
 * Pasos completos: docs/26-RESPALDOS.md.
 */
const [clientId, clientSecret, respuesta] = process.argv.slice(2);
const REDIRECT = 'http://127.0.0.1:53682/';

if (!clientId || !clientSecret) {
  console.error('Uso: node scripts/drive-token.mjs <CLIENT_ID> <CLIENT_SECRET> [URL de respuesta]');
  process.exit(1);
}

if (!respuesta) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
  }).toString();
  console.log('Abre este enlace y acepta:\n\n' + url + '\n');
  console.log('Luego copia la URL de la barra (empieza con http://127.0.0.1:53682/?code=) y corre el paso 2.');
  process.exit(0);
}

const code = respuesta.startsWith('http') ? new URL(respuesta).searchParams.get('code') : respuesta;
const res = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
});
const j = await res.json();
if (!j.refresh_token) {
  console.error('Google no devolvió refresh_token:', j);
  process.exit(1);
}
console.log('\nGDRIVE_REFRESH_TOKEN=' + j.refresh_token);
