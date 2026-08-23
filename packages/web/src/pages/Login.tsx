import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/** Magic link: los asesores no gestionan contraseñas. */
export default function Login() {
  // Quién es el cliente de este subdominio. Se muestra para que nadie dude de en qué
  // CRM está entrando cuando administra varios.
  const tenant = useQuery({
    queryKey: ['tenant'],
    queryFn: () => api.get<{ tenant: { name: string; slug: string } | null }>('/auth/tenant'),
    retry: false,
  });

  const [email, setEmail] = useState('');
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'error'>('idle');

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado('enviando');
    try {
      await api.post('/auth/magic-link', { email });
      setEstado('enviado');
    } catch {
      setEstado('error');
    }
  }

  return (
    <div className="login card">
      <div className="marca" style={{ fontSize: 22, marginBottom: 4 }}>Lucuma CRM</div>
      {tenant.data?.tenant && (
        <p className="nombre" style={{ marginTop: 0 }}>{tenant.data.tenant.name}</p>
      )}
      <p className="meta">Te enviamos un enlace de acceso a tu correo.</p>
      <form onSubmit={enviar}>
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
        <button className="btn btn-bloque" style={{ marginTop: 16 }} disabled={estado === 'enviando'}>
          {estado === 'enviando' ? 'Enviando…' : 'Enviar enlace'}
        </button>
      </form>
      {estado === 'enviado' && (
        <p className="ok">Si el correo existe, te llegará un enlace. Vence en 20 minutos.</p>
      )}
      {estado === 'error' && <p className="error">No se pudo enviar. Intenta de nuevo.</p>}
    </div>
  );
}
