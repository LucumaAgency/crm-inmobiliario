import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/**
 * Correo y contraseña. El enlace al correo queda como respaldo: para quien aún no tiene
 * contraseña o la olvidó.
 */
export default function Login() {
  const qc = useQueryClient();
  // Quién es el cliente de este subdominio. Se muestra para que nadie dude de en qué
  // CRM está entrando cuando administra varios.
  const tenant = useQuery({
    queryKey: ['tenant'],
    queryFn: () => api.get<{ tenant: { name: string; slug: string } | null }>('/auth/tenant'),
    retry: false,
  });

  const [modo, setModo] = useState<'password' | 'enlace'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');
  const [error, setError] = useState('');

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEstado('enviando');
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError((err as Error).message);
      setEstado('error');
    }
  }

  async function pedirEnlace(e: React.FormEvent) {
    e.preventDefault();
    setEstado('enviando');
    try {
      await api.post('/auth/magic-link', { email });
      setEstado('enviado');
    } catch {
      setError('No se pudo enviar. Intenta de nuevo.');
      setEstado('error');
    }
  }

  function cambiarModo(m: 'password' | 'enlace') {
    setModo(m);
    setEstado('idle');
    setError('');
  }

  return (
    <div className="login-pagina">
      <div className="login card">
        <div className="lateral-marca" style={{ padding: 0 }}>
          <span className="wordmark">Lucuma Agency</span>
          <span className="producto">CRM</span>
        </div>
        <h2>{modo === 'password' ? 'Inicia sesión' : 'Entrar con enlace'}</h2>
        <p className="meta" style={{ marginTop: 0 }}>
          {tenant.data?.tenant
            ? `CRM de ${tenant.data.tenant.name}`
            : 'Gestión comercial inmobiliaria'}
        </p>

        <form onSubmit={modo === 'password' ? entrar : pedirEnlace}>
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@empresa.com"
            required
            autoComplete="email"
          />
          {modo === 'password' && (
            <>
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </>
          )}
          <button
            className="btn btn-bloque"
            style={{ marginTop: 16 }}
            disabled={estado === 'enviando'}
          >
            {estado === 'enviando'
              ? modo === 'password'
                ? 'Entrando…'
                : 'Enviando…'
              : modo === 'password'
                ? 'Entrar'
                : 'Enviar enlace'}
          </button>
        </form>

        {estado === 'enviado' && (
          <p className="ok">Si el correo existe, te llegará un enlace. Vence en 20 minutos.</p>
        )}
        {estado === 'error' && <p className="error">{error}</p>}

        <p className="meta" style={{ marginTop: 16, textAlign: 'center' }}>
          {modo === 'password' ? (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                cambiarModo('enlace');
              }}
            >
              ¿Sin contraseña u olvidada? Entra con enlace al correo
            </a>
          ) : (
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                cambiarModo('password');
              }}
            >
              Entrar con contraseña
            </a>
          )}
        </p>
      </div>
    </div>
  );
}
