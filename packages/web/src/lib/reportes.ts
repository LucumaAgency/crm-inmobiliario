export interface Indicadores {
  leads: number;
  contactados: number;
  tasaContacto: number | null;
  medianaPrimerContactoMin: number | null;
  ganados: number;
}

export interface Resumen {
  dias: number;
  desde: string;
  hasta: string;
  actual: Indicadores;
  previo: Indicadores;
  sinContactar: number;
  serie: {
    fecha: string;
    leads: number;
    contactados: number;
    ganados: number;
    leadsPrev: number;
    contactadosPrev: number;
    ganadosPrev: number;
  }[];
  porFuente: { source: string; n: number; nPrev: number }[];
  porEtapa: { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean; n: number }[];
  porProyecto: { id: string | null; name: string; n: number }[];
}

export const PERIODOS = [
  { dias: 7, texto: 'Últimos 7 días' },
  { dias: 30, texto: 'Últimos 30 días' },
  { dias: 90, texto: 'Últimos 90 días' },
];

export const FUENTES: Record<string, string> = {
  web_form: 'Formulario web',
  whatsapp: 'WhatsApp',
  meta_ads: 'Meta Lead Ads',
  manual: 'Alta manual',
  import: 'Importación',
};

/** Minutos en la unidad que se lee mejor: 12 min, 3,5 h, 2 d. */
export function duracion(min: number | null): { valor: string; unidad: string } {
  if (min === null) return { valor: '—', unidad: '' };
  if (min < 60) return { valor: String(Math.round(min)), unidad: 'min' };
  if (min < 60 * 24) return { valor: (min / 60).toFixed(1).replace('.', ','), unidad: 'h' };
  return { valor: (min / 1440).toFixed(1).replace('.', ','), unidad: 'd' };
}

export function porcentaje(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`;
}

/**
 * Variación frente al período anterior. `menosEsMejor` invierte el color: que el tiempo
 * de primer contacto baje es una buena noticia.
 */
export function variacion(
  actual: number | null,
  previo: number | null,
  menosEsMejor = false
): { texto: string; tono: 'sube' | 'baja' | '' } {
  if (actual === null || previo === null) return { texto: 'sin datos previos', tono: '' };
  if (previo === 0) return { texto: actual === 0 ? 'sin cambios' : 'nuevo', tono: '' };
  const cambio = (actual - previo) / previo;
  if (Math.abs(cambio) < 0.005) return { texto: '0%', tono: '' };
  const mejora = menosEsMejor ? cambio < 0 : cambio > 0;
  return {
    texto: `${cambio > 0 ? '+' : ''}${Math.round(cambio * 100)}%`,
    tono: mejora ? 'sube' : 'baja',
  };
}
