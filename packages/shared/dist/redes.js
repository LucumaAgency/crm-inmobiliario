/**
 * Redes sociales de un contacto. Se guardan tal como se escriben (usuario «@marca» o enlace) y
 * se convierten en enlace al mostrarlas.
 */
export const REDES = [
    { campo: 'instagram', nombre: 'Instagram', base: 'https://instagram.com/', ejemplo: '@usuario' },
    { campo: 'facebook', nombre: 'Facebook', base: 'https://facebook.com/', ejemplo: 'facebook.com/pagina' },
    { campo: 'tiktok', nombre: 'TikTok', base: 'https://tiktok.com/@', ejemplo: '@usuario' },
    { campo: 'linkedin', nombre: 'LinkedIn', base: 'https://linkedin.com/in/', ejemplo: 'linkedin.com/in/usuario' },
    { campo: 'website', nombre: 'Página web', base: 'https://', ejemplo: 'empresa.com' },
];
/** «@marca», «marca» o un enlace → enlace navegable. Null si está vacío. */
export function enlaceRed(campo, valor) {
    const v = (valor ?? '').trim();
    if (!v)
        return null;
    if (/^https?:\/\//i.test(v))
        return v;
    if (campo === 'website' || /\.[a-z]{2,}\//i.test(v) || /^(www\.)?[a-z0-9-]+\.[a-z]{2,}/i.test(v))
        return `https://${v.replace(/^\/+/, '')}`;
    const red = REDES.find((r) => r.campo === campo);
    return red.base + v.replace(/^@/, '');
}
