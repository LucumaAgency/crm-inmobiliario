export function fecha(v: string | Date | null | undefined) {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-PE', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

export function desde(v: string | Date | null | undefined) {
  if (!v) return '—';
  const min = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

export function precio(v: number | string | null | undefined, moneda = 'PEN') {
  if (v === null || v === undefined) return '—';
  return new Intl.NumberFormat('es-PE', { style: 'currency', currency: moneda, maximumFractionDigits: 0 })
    .format(Number(v));
}

export function whatsappUrl(phone: string | null | undefined, texto?: string) {
  if (!phone) return null;
  const n = phone.replace(/[^\d]/g, '');
  return `https://wa.me/${n}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}
