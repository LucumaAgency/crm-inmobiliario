/**
 * Tema de la interfaz: claro, noche o según el sistema. Se guarda por dispositivo
 * (localStorage): el mismo asesor puede preferir noche en el celular y claro en la oficina.
 * index.html aplica lo guardado antes de pintar, para que no parpadee en claro.
 */
export type Tema = 'claro' | 'oscuro' | 'auto';
const CLAVE = 'lcrm-tema';

export function temaGuardado(): Tema {
  try {
    const v = localStorage.getItem(CLAVE);
    return v === 'oscuro' || v === 'auto' ? v : 'claro';
  } catch {
    return 'claro';
  }
}

export function aplicarTema(t: Tema) {
  const raiz = document.documentElement;
  if (t === 'claro') raiz.removeAttribute('data-tema');
  else raiz.setAttribute('data-tema', t);
  const oscuro = t === 'oscuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', oscuro ? '#141920' : '#EFF2F7');
}

export function guardarTema(t: Tema) {
  try {
    localStorage.setItem(CLAVE, t);
  } catch {
    /* modo privado: se aplica igual en esta sesión */
  }
  aplicarTema(t);
}

/** ¿Se ve oscuro ahora mismo? (para el interruptor rápido del menú) */
export function esOscuroAhora(): boolean {
  const t = temaGuardado();
  return t === 'oscuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
