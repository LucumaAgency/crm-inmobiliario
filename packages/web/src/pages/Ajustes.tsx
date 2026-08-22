import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Site {
  id: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  active: boolean;
}

export default function Ajustes() {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [dominios, setDominios] = useState('');
  const [secretNueva, setSecretNueva] = useState<string | null>(null);

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites') });
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; email: string; role: string }[]>('/users'),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ secretKey: string }>('/sites', {
        name: nombre,
        allowedOrigins: dominios.split(',').map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: (res) => {
      setSecretNueva(res.secretKey);
      setNombre(''); setDominios('');
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const rotar = useMutation({
    mutationFn: (id: string) => api.post<{ secretKey: string }>(`/sites/${id}/rotate`),
    onSuccess: (res) => setSecretNueva(res.secretKey),
  });

  return (
    <>
      <div className="card">
        <strong>Sitios conectados</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Cada sitio tiene dos llaves. La <strong>pública</strong> va en el HTML y está restringida
          por dominio. La <strong>secreta</strong> vive solo en el servidor de WordPress y no se
          vuelve a mostrar.
        </p>

        {sites.data?.map((s) => (
          <div key={s.id} className="card" style={{ background: '#fafbfc', marginTop: 10 }}>
            <div className="fila">
              <span className="nombre">{s.name}</span>
              <span className={s.active ? 'chip' : 'chip chip-gris'}>{s.active ? 'activo' : 'inactivo'}</span>
            </div>
            <label>Public key</label>
            <div className="codigo">{s.publicKey}</div>
            <label>Dominios autorizados</label>
            <div className="meta">{(s.allowedOrigins ?? []).join(', ')}</div>
            <button className="btn btn-sec" style={{ marginTop: 12 }} onClick={() => rotar.mutate(s.id)}>
              Rotar secret key
            </button>
          </div>
        ))}

        {secretNueva && (
          <div className="card" style={{ borderColor: '#10b981', marginTop: 10 }}>
            <strong>Secret key nueva</strong>
            <p className="meta">Cópiala ahora: no se vuelve a mostrar. Va en los ajustes del plugin.</p>
            <div className="codigo">{secretNueva}</div>
            <button className="btn btn-sec" style={{ marginTop: 10 }} onClick={() => setSecretNueva(null)}>
              Ya la copié
            </button>
          </div>
        )}

        <label>Nombre del sitio</label>
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="proyectodomus.pe" />
        <label>Dominios autorizados (separados por coma)</label>
        <input
          value={dominios}
          onChange={(e) => setDominios(e.target.value)}
          placeholder="proyectodomus.pe, www.proyectodomus.pe"
        />
        <button
          className="btn btn-bloque"
          style={{ marginTop: 14 }}
          onClick={() => crear.mutate()}
          disabled={crear.isPending || !nombre || !dominios}
        >
          Crear sitio y generar llaves
        </button>
      </div>

      <div className="card">
        <strong>Usuarios</strong>
        <table className="tabla" style={{ marginTop: 10 }}>
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th></tr></thead>
          <tbody>
            {usuarios.data?.map((u) => (
              <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td>{u.role}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <strong>Exportar</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          La descarga queda registrada en la auditoría: quién, cuándo y cuántos registros.
        </p>
        <a className="btn btn-sec" href="/api/v1/leads/export">Descargar leads en CSV</a>
      </div>
    </>
  );
}
