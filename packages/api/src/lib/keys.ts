import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Public key: viaja en el HTML del sitio. Restringida por dominio, no por secreto. */
export function generatePublicKey(): string {
  return 'pk_' + randomBytes(18).toString('base64url');
}

/** Secret key: vive solo en el servidor del sitio (opción de WordPress). */
export function generateSecretKey(): string {
  return 'sk_' + randomBytes(32).toString('base64url');
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** ¿El Origin de la petición está en la lista blanca del sitio? */
export function originAllowed(origin: string | undefined, allowed: unknown): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((raw) => {
    const entry = String(raw).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!entry) return false;
    if (entry.startsWith('*.')) {
      const base = entry.slice(2);
      return host === base || host.endsWith('.' + base);
    }
    return host === entry;
  });
}
