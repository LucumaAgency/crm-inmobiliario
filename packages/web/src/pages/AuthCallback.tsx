import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function AuthCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('Falta el token del enlace.');
      return;
    }
    api
      .post('/auth/callback', { token })
      .then(() => { window.location.href = '/leads'; })
      .catch((e) => setError(e.message ?? 'Enlace inválido o vencido.'));
  }, []);

  return (
    <div className="login card">
      {error ? (
        <>
          <p className="error">{error}</p>
          <a className="btn btn-sec btn-bloque" href="/" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>
            Volver a pedir acceso
          </a>
        </>
      ) : (
        <p>Entrando…</p>
      )}
    </div>
  );
}
