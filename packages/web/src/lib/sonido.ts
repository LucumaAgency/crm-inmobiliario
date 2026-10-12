/**
 * Sonido de aviso para mensajes nuevos de WhatsApp: un «ding» simple generado con
 * Web Audio (sin archivos). Preferencia por navegador en localStorage, encendido por
 * defecto. Los navegadores exigen un gesto del usuario antes de reproducir audio: el
 * AudioContext se crea en el primer clic y, si aún no existe, el ding se omite en silencio.
 */
const CLAVE = 'lcrm.sonidoWa';
let ctx: AudioContext | null = null;

export function sonidoActivo(): boolean {
  try { return localStorage.getItem(CLAVE) !== '0'; } catch { return true; }
}

export function setSonidoActivo(v: boolean) {
  try { localStorage.setItem(CLAVE, v ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

/** Llamar desde un gesto del usuario (clic). Idempotente. */
export function prepararSonido() {
  if (ctx || typeof window === 'undefined') return;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try { ctx = new AC(); } catch { ctx = null; }
}

/** Ding simple: una nota limpia (E6) con ataque corto y cola de ~0,5 s. */
export function ding(forzar = false) {
  if (!forzar && !sonidoActivo()) return;
  if (!ctx) prepararSonido();
  if (!ctx) return;
  // En segundo plano el contexto suele quedar suspendido: hay que esperar a que
  // reanude antes de programar la nota, o se pierde.
  if (ctx.state === 'suspended') {
    ctx.resume().then(() => tocar(), () => undefined);
    return;
  }
  tocar();
}

function tocar() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1318.5, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.25, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.6);
}
