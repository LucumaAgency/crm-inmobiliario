import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import MetaLeadAds from './MetaLeadAds.js';
import WhatsAppNumeros from './WhatsAppNumeros.js';
import Registro from './Registro.js';

interface Site {
  id: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
  active: boolean;
}

const ROLES: Record<string, string> = {
  admin_lucuma: 'Admin Lucuma',
  gerente: 'Gerente',
  asesor: 'Asesor',
  solo_lectura: 'Solo lectura',
};

export default function Ajustes({ rol }: { rol: string }) {
  const qc = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [dominios, setDominios] = useState('');
  const [secretNueva, setSecretNueva] = useState<string | null>(null);
  const [uNombre, setUNombre] = useState('');
  const [uCorreo, setUCorreo] = useState('');
  const [uRol, setURol] = useState('asesor');

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites') });
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () =>
      api.get<{ id: string; name: string; email: string; role: string; active: boolean }[]>('/users'),
  });

  const cambiarUsuario = useMutation({
    mutationFn: (v: { id: string; active?: boolean; role?: string }) =>
      api.patch(`/users/${v.id}`, { active: v.active, role: v.role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const crearUsuario = useMutation({
    mutationFn: () =>
      api.post('/users', { name: uNombre.trim(), email: uCorreo.trim(), role: uRol }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setUNombre('');
      setUCorreo('');
      setURol('asesor');
    },
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
          <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th></th></tr></thead>
          <tbody>
            {usuarios.data?.map((u) => (
              <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                <td>
                  {u.name}
                  {!u.active && <span className="chip chip-gris" style={{ marginLeft: 6 }}>inactivo</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={cambiarUsuario.isPending}
                    onChange={(e) => cambiarUsuario.mutate({ id: u.id, role: e.target.value })}
                  >
                    {Object.entries(ROLES).map(([valor, etiqueta]) => (
                      <option key={valor} value={valor}>{etiqueta}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-sec"
                    disabled={cambiarUsuario.isPending}
                    onClick={() => cambiarUsuario.mutate({ id: u.id, active: !u.active })}
                  >
                    {u.active ? 'Desactivar' : 'Activar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form
          style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (uNombre.trim() && uCorreo.trim()) crearUsuario.mutate();
          }}
        >
          <div className="rejilla-2">
            <div>
              <label htmlFor="u-nombre">Nombre</label>
              <input id="u-nombre" value={uNombre} onChange={(e) => setUNombre(e.target.value)} />
            </div>
            <div>
              <label htmlFor="u-correo">Correo</label>
              <input id="u-correo" type="email" value={uCorreo} onChange={(e) => setUCorreo(e.target.value)} />
            </div>
          </div>
          <label htmlFor="u-rol">Rol</label>
          <select id="u-rol" value={uRol} onChange={(e) => setURol(e.target.value)}>
            {Object.entries(ROLES).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>{etiqueta}</option>
            ))}
          </select>
          <p className="meta" style={{ marginTop: 8 }}>
            No se define contraseña: la persona entra con un enlace de acceso enviado a ese
            correo, así que tiene que ser un buzón real que pueda abrir. Los usuarios no se
            borran, se desactivan: aparecen en asignaciones, actividades y auditoría, y
            borrarlos dejaría el historial sin dueño. Un asesor inactivo no puede entrar ni
            recibe leads nuevos.
          </p>
          {crearUsuario.isError && <p className="error">{(crearUsuario.error as Error).message}</p>}
          {cambiarUsuario.isError && <p className="error">{(cambiarUsuario.error as Error).message}</p>}
          <div className="acciones">
            <button
              type="submit"
              className="btn"
              disabled={!uNombre.trim() || !uCorreo.trim() || crearUsuario.isPending}
            >
              {crearUsuario.isPending ? 'Creando…' : 'Añadir usuario'}
            </button>
          </div>
        </form>
      </div>

      <MetaLeadAds />

      <WhatsAppNumeros />

      {rol === 'admin_lucuma' && <Registro />}

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
