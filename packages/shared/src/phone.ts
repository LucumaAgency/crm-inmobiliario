/**
 * Normalización de teléfonos peruanos a E.164.
 * El teléfono es la clave de deduplicación más usada en el rubro, así que tiene que
 * quedar guardado siempre en el mismo formato.
 */
export function normalizePhonePE(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = String(input).replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');

  if (digits.startsWith('+')) {
    const rest = digits.slice(1);
    return rest.length >= 8 ? `+${rest}` : null;
  }
  const d = digits.replace(/^0+/, '');
  if (d.startsWith('51') && d.length === 11) return `+${d}`;      // 51 + 9 dígitos
  if (d.length === 9 && d.startsWith('9')) return `+51${d}`;       // celular peruano
  if (d.length === 8) return `+51${d}`;                            // fijo de Lima sin código
  return d.length >= 8 ? `+${d}` : null;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const e = String(input).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function normalizeDocument(input: string | null | undefined): string | null {
  if (!input) return null;
  const d = String(input).replace(/[^\dA-Za-z]/g, '').toUpperCase();
  return d.length >= 6 ? d : null;
}
