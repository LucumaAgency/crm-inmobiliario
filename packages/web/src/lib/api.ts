const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch { /* respuesta sin JSON */ }
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: <T>(p: string, body?: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
