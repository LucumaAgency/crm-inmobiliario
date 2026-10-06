import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PERMISOS, ROLES_BASE, type Permiso } from '@lucuma-crm/shared';
import { api, ApiError } from '../lib/api.js';
import Icono from '../components/Icono.js';

interface Rol { id: string; name: string; permissions: Permiso[]; _count: { users: number } }

const GRUPOS = [...new Set(PERMISOS.map((p) => p.grupo))];

/**
 * Roles de la organización: un nombre y una lista de casillas.
 *
 * Los cuatro roles base se muestran como referencia, sin editar: son los que Lucuma garantiza
 * y los que usan los textos de ayuda. Cada inmobiliaria arma los suyos encima («Jefe de
 * ventas» que ve todo y reasigna pero no toca precios; «Marketing» que configura canales y
 * mira reportes). Los permisos se aplican al minuto siguiente de guardar, sin cerrar sesión.
 */
export default function Roles() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Rol[]>('/roles') });
  const [editando, setEditando] = useState<{ id?: string; name: string; permissions: Permiso[] } | null>(null);
  const [borrando, setBorrando] = useState<Rol | null>(null);
  const [pasarA, setPasarA] = useState('asesor');
  const [verBase, setVerBase] = useState(false);

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['roles'] });
    qc.invalidateQueries({ queryKey: ['users'] });
    qc.invalidateQueries({ queryKey: ['me'] });
  };
  const guardar = useMutation({
    mutationFn: (r: { id?: string; name: string; permissions: Permiso[] }) =>
      r.id ? api.patch(`/roles/${r.id}`, { name: r.name, permissions: r.permissions }) : api.post('/roles', { name: r.name, permissions: r.permissions }),
    onSuccess: () => { setEditando(null); refrescar(); },
  });
  const borrar = useMutation({
    mutationFn: (v: { id: string; pasarA?: string }) =>
      api.del(`/roles/${v.id}${v.pasarA ? `?pasarA=${v.pasarA}` : ''}`),
    onSuccess: () => { setBorrando(null); refrescar(); },
  });

  function alternar(p: Permiso) {
    if (!editando) return;
    const tiene = editando.permissions.includes(p);
    setEditando({ ...editando, permissions: tiene ? editando.permissions.filter((x) => x !== p) : [...editando.permissions, p] });
  }

  return (
    <>
      <div className="card">
        <div className="fila">
          <strong>Roles de la organización</strong>
          {!editando && (
            <button type="button" className="btn" onClick={() => setEditando({ name: '', permissions: ['leads.editar', 'reportes.ver'] })}>
              <Icono nombre="mas" tam={15} />Nuevo rol
            </button>
          )}
        </div>
        <p className="meta" style={{ marginTop: 6 }}>
          Cada inmobiliaria tiene su estructura. Un rol es un nombre y una lista de permisos: márcalos
          y asígnalo a las personas en Usuarios. Los cambios aplican en menos de un minuto, sin que
          nadie cierre sesión.
        </p>

        {roles.isLoading && <p className="meta">Cargando…</p>}
        {roles.data && roles.data.length === 0 && !editando && (
          <p className="meta">
            Todavía no hay roles propios. Los cuatro roles base (Admin Lucuma, Gerente, Asesor, Solo
            lectura) siguen disponibles en Usuarios.
          </p>
        )}

        {roles.data && roles.data.length > 0 && (
          <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Usuarios</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.data.map((r) => (
                <tr key={r.id}>
                  <td className="t-titulo">{r.name}</td>
                  <td data-label="Permisos" className="ancho">
                    <span className="meta">
                      {r.permissions.length === 0
                        ? 'Sin permisos'
                        : PERMISOS.filter((p) => r.permissions.includes(p.id)).map((p) => p.nombre).join(' · ')}
                    </span>
                  </td>
                  <td data-label="Usuarios">{r._count.users}</td>
                  <td className="accion">
                    <button type="button" className="btn btn-sec" onClick={() => setEditando({ id: r.id, name: r.name, permissions: r.permissions })}>
                      Editar
                    </button>{' '}
                    <button type="button" className="btn btn-sec" onClick={() => { setBorrando(r); setPasarA('asesor'); }}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {editando && (
          <form
            style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
            onSubmit={(e) => { e.preventDefault(); if (editando.name.trim()) guardar.mutate({ ...editando, name: editando.name.trim() }); }}
          >
            <label htmlFor="rol-nombre">Nombre del rol</label>
            <input
              id="rol-nombre"
              value={editando.name}
              onChange={(e) => setEditando({ ...editando, name: e.target.value })}
              placeholder="Jefe de ventas, Marketing, Caseta…"
              maxLength={40}
              autoFocus
            />
            {GRUPOS.map((g) => (
              <fieldset key={g} className="permisos-grupo">
                <legend>{g}</legend>
                {PERMISOS.filter((p) => p.grupo === g).map((p) => (
                  <label key={p.id} className={`casilla casilla-permiso ${editando.permissions.includes(p.id) ? 'marcada' : ''}`}>
                    <input type="checkbox" checked={editando.permissions.includes(p.id)} onChange={() => alternar(p.id)} />
                    <span>
                      <strong>{p.nombre}</strong>
                      <span className="meta">{p.detalle}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}
            {guardar.isError && <p className="error">{(guardar.error as ApiError).message}</p>}
            <div className="acciones">
              <button type="submit" className="btn" disabled={!editando.name.trim() || guardar.isPending}>
                {guardar.isPending ? 'Guardando…' : editando.id ? 'Guardar cambios' : 'Crear rol'}
              </button>
              <button type="button" className="btn btn-sec" onClick={() => { setEditando(null); guardar.reset(); }}>Cancelar</button>
            </div>
          </form>
        )}

        {borrando && (
          <div className="modal-fondo" onClick={() => setBorrando(null)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-cab">
                <h2>Borrar «{borrando.name}»</h2>
                <button type="button" className="cerrar" onClick={() => setBorrando(null)} aria-label="Cerrar">×</button>
              </div>
              {borrando._count.users > 0 ? (
                <>
                  <p className="meta">
                    {borrando._count.users === 1 ? '1 persona tiene' : `${borrando._count.users} personas tienen`} este rol.
                    Elige a qué rol base pasan; nadie se queda sin permisos.
                  </p>
                  <label htmlFor="rol-pasar">Pasan a</label>
                  <select id="rol-pasar" value={pasarA} onChange={(e) => setPasarA(e.target.value)}>
                    <option value="gerente">Gerente</option>
                    <option value="asesor">Asesor</option>
                    <option value="solo_lectura">Solo lectura</option>
                  </select>
                </>
              ) : (
                <p className="meta">Nadie tiene este rol. Se borra sin más.</p>
              )}
              {borrar.isError && <p className="error">{(borrar.error as ApiError).message}</p>}
              <div className="acciones" style={{ marginTop: 16 }}>
                <button type="button" className="btn" disabled={borrar.isPending} onClick={() => borrar.mutate({ id: borrando.id, pasarA: borrando._count.users > 0 ? pasarA : undefined })}>
                  Borrar rol
                </button>
                <button type="button" className="btn btn-sec" onClick={() => setBorrando(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="fila">
          <strong>Roles base</strong>
          <button type="button" className="btn btn-sec" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setVerBase((v) => !v)}>
            {verBase ? 'Ocultar' : 'Ver qué permite cada uno'}
          </button>
        </div>
        <p className="meta" style={{ marginTop: 6 }}>
          Admin Lucuma, Gerente, Asesor y Solo lectura vienen fijos. Si ninguno encaja, crea un rol
          arriba partiendo de lo que necesites.
        </p>
        {verBase && (
          <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Permiso</th>
                {Object.values(ROLES_BASE).map((r) => <th key={r.nombre}>{r.nombre}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISOS.map((p) => (
                <tr key={p.id}>
                  <td className="t-titulo">{p.nombre}</td>
                  {Object.values(ROLES_BASE).map((r) => (
                    <td key={r.nombre} data-label={r.nombre}>{r.permisos.includes(p.id) ? <span className="chip chip-verde">Sí</span> : <span className="meta">—</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
