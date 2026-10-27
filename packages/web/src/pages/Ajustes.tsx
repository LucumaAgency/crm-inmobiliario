import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import MetaLeadAds from './MetaLeadAds.js';
import WhatsAppNumeros from './WhatsAppNumeros.js';
import PlantillasWhatsApp from './PlantillasWhatsApp.js';
import Registro from './Registro.js';
import EtapasEditor from './EtapasEditor.js';
import AjustesVoz from './AjustesVoz.js';
import AjustesEmbudo from './AjustesEmbudo.js';
import Roles from './Roles.js';
import MigracionSperant from './MigracionSperant.js';
import Diagnostico from './Diagnostico.js';
import Respaldos from './Respaldos.js';
import RepartoLeads from './RepartoLeads.js';
import { useNotasVoz, usePuede } from '../lib/permisos.js';
import { PASSWORD_MIN, usaSperant, type Permiso } from '@lucuma-crm/shared';

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

const SECCIONES: { id: string; texto: string; permiso: Permiso }[] = [
  { id: 'embudo', texto: 'Embudo', permiso: 'embudo.configurar' },
  { id: 'sitios', texto: 'Sitios web', permiso: 'canales.configurar' },
  { id: 'usuarios', texto: 'Usuarios', permiso: 'usuarios.gestionar' },
  { id: 'roles', texto: 'Roles', permiso: 'usuarios.gestionar' },
  { id: 'meta', texto: 'Meta Lead Ads', permiso: 'canales.configurar' },
  { id: 'whatsapp', texto: 'WhatsApp', permiso: 'canales.configurar' },
  { id: 'voz', texto: 'Notas de voz', permiso: 'embudo.configurar' },
  { id: 'sperant', texto: 'Migración Sperant', permiso: 'canales.configurar' },
  { id: 'diagnostico', texto: 'Diagnóstico', permiso: 'usuarios.gestionar' },
  { id: 'respaldos', texto: 'Respaldos', permiso: 'respaldos.descargar' },
  { id: 'registro', texto: 'Registro', permiso: 'registro.ver' },
  { id: 'exportar', texto: 'Exportar', permiso: 'leads.exportar' },
];

export default function Ajustes({ rol: _rol }: { rol: string }) {
  const qc = useQueryClient();
  // La sección va en la URL: recargar o compartir el enlace no te devuelve a la primera.
  const [params, setParams] = useSearchParams();
  const puede = usePuede();
  const notasVoz = useNotasVoz();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ organization: { slug: string } | null }>('/auth/me') });
  const conSperant = usaSperant(me.data?.organization?.slug);
  const visibles = SECCIONES.filter(
    (x) => puede(x.permiso) && (x.id !== 'voz' || notasVoz) && (x.id !== 'sperant' || conSperant),
  );
  const seccion = visibles.some((x) => x.id === params.get('seccion'))
    ? params.get('seccion')!
    : (visibles[0]?.id ?? 'embudo');
  const [nombre, setNombre] = useState('');
  const [dominios, setDominios] = useState('');
  const [secretNueva, setSecretNueva] = useState<string | null>(null);
  const [uNombre, setUNombre] = useState('');
  const [uCorreo, setUCorreo] = useState('');
  const [uRol, setURol] = useState('asesor');
  const [uClave, setUClave] = useState('');
  const [claveDe, setClaveDe] = useState<string | null>(null);

  const sites = useQuery({ queryKey: ['sites'], queryFn: () => api.get<Site[]>('/sites') });
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () =>
      api.get<{ id: string; name: string; email: string; role: string; active: boolean; maxDiscountPct: string | null; customRoleId: string | null; tienePassword: boolean; protegida?: boolean }[]>(
        '/users',
      ),
  });
  const rolesPropios = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/roles'),
  });

  const cambiarUsuario = useMutation({
    mutationFn: (v: { id: string; active?: boolean; role?: string; maxDiscountPct?: number | null }) =>
      api.patch(`/users/${v.id}`, { active: v.active, maxDiscountPct: v.maxDiscountPct, ...rolAPayload(v.role) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const crearUsuario = useMutation({
    mutationFn: () =>
      api.post('/users', {
        name: uNombre.trim(),
        email: uCorreo.trim(),
        password: uClave || undefined,
        ...rolAPayload(uRol),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setUNombre('');
      setUCorreo('');
      setURol('asesor');
      setUClave('');
    },
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ secretKey: string }>('/sites', {
        name: nombre,
        allowedOrigins: dominios
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: (res) => {
      setSecretNueva(res.secretKey);
      setNombre('');
      setDominios('');
      qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const rotar = useMutation({
    mutationFn: (id: string) => api.post<{ secretKey: string }>(`/sites/${id}/rotate`),
    onSuccess: (res) => setSecretNueva(res.secretKey),
  });

  return (
    <>
      {/* Siete secciones apiladas eran una página interminable en el celular. */}
      <nav className="pestanas" aria-label="Secciones de ajustes">
        {visibles.map((x) => (
          <button
            key={x.id}
            type="button"
            className={seccion === x.id ? 'activa' : ''}
            onClick={() => setParams({ seccion: x.id }, { replace: true })}
          >
            {x.texto}
          </button>
        ))}
      </nav>

      {seccion === 'embudo' && (
        <>
          <EtapasEditor />
          <AjustesEmbudo />
        </>
      )}

      {seccion === 'sitios' && (
        <div className="card">
          <strong>Sitios conectados</strong>
          <p className="meta" style={{ marginTop: 6 }}>
            Cada sitio tiene dos llaves. La <strong>pública</strong> va en el HTML y está
            restringida por dominio. La <strong>secreta</strong> vive solo en el servidor de
            WordPress y no se vuelve a mostrar.
          </p>

          {sites.data?.map((s) => (
            <div key={s.id} className="card" style={{ background: 'var(--superficie-2)', marginTop: 10 }}>
              <div className="fila">
                <span className="nombre">{s.name}</span>
                <span className={s.active ? 'chip' : 'chip chip-gris'}>
                  {s.active ? 'activo' : 'inactivo'}
                </span>
              </div>
              <label>Public key</label>
              <div className="codigo">{s.publicKey}</div>
              <label>Dominios autorizados</label>
              <div className="meta">{(s.allowedOrigins ?? []).join(', ')}</div>
              <button
                className="btn btn-sec"
                style={{ marginTop: 12 }}
                onClick={() => rotar.mutate(s.id)}
              >
                Rotar secret key
              </button>
            </div>
          ))}

          {secretNueva && (
            <div className="card" style={{ borderColor: 'var(--verde)', marginTop: 10 }}>
              <strong>Secret key nueva</strong>
              <p className="meta">
                Cópiala ahora: no se vuelve a mostrar. Va en los ajustes del plugin.
              </p>
              <div className="codigo">{secretNueva}</div>
              <button
                className="btn btn-sec"
                style={{ marginTop: 10 }}
                onClick={() => setSecretNueva(null)}
              >
                Ya la copié
              </button>
            </div>
          )}

          <label>Nombre del sitio</label>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="proyectodomus.pe"
          />
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
      )}

      {seccion === 'usuarios' && <RepartoLeads />}

      {seccion === 'usuarios' && (
        <div className="card">
          <strong>Usuarios</strong>
          <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Correo</th>
                <th>Rol</th>
                <th>Desc. máx.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.data?.map((u) => (
                <tr key={u.id} style={u.active ? undefined : { opacity: 0.55 }}>
                  <td className="t-titulo">
                    {u.name}
                    {!u.active && (
                      <span className="chip chip-gris" style={{ marginLeft: 6 }}>
                        inactivo
                      </span>
                    )}
                    {u.protegida && (
                      <span className="chip chip-gris" style={{ marginLeft: 6 }} title="No se puede desactivar ni cambiar de rol">
                        cuenta Lucuma
                      </span>
                    )}
                  </td>
                  <td className="ancho meta">
                    {u.email}
                    <br />
                    <span style={{ fontSize: 12 }}>{u.tienePassword ? 'con contraseña' : 'solo enlace al correo'}</span>
                  </td>
                  <td data-label="Rol">
                    <select
                      value={u.customRoleId ? `custom:${u.customRoleId}` : u.role}
                      disabled={cambiarUsuario.isPending || u.protegida}
                      onChange={(e) => cambiarUsuario.mutate({ id: u.id, role: e.target.value })}
                    >
                      <OpcionesRol propios={rolesPropios.data ?? []} />
                    </select>
                  </td>
                  <td data-label="Descuento máximo">
                    <DescuentoUsuario
                      valor={u.maxDiscountPct}
                      disabled={cambiarUsuario.isPending}
                      onGuardar={(v) => cambiarUsuario.mutate({ id: u.id, maxDiscountPct: v })}
                    />
                  </td>
                  <td className="accion">
                    {u.protegida ? (
                      <span className="meta">Protegida</span>
                    ) : (
                    <>
                    <button
                      type="button"
                      className="btn btn-sec"
                      onClick={() => setClaveDe(claveDe === u.id ? null : u.id)}
                    >
                      Contraseña
                    </button>{' '}
                    <button
                      type="button"
                      className="btn btn-sec"
                      disabled={cambiarUsuario.isPending}
                      onClick={() => cambiarUsuario.mutate({ id: u.id, active: !u.active })}
                    >
                      {u.active ? 'Desactivar' : 'Activar'}
                    </button>
                    </>
                    )}
                    {claveDe === u.id && (
                      <ClaveUsuario
                        id={u.id}
                        nombre={u.name}
                        tiene={u.tienePassword}
                        onListo={() => {
                          setClaveDe(null);
                          qc.invalidateQueries({ queryKey: ['users'] });
                        }}
                      />
                    )}
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
                <input
                  id="u-correo"
                  type="email"
                  value={uCorreo}
                  onChange={(e) => setUCorreo(e.target.value)}
                />
              </div>
            </div>
            <div className="rejilla-2">
              <div>
                <label htmlFor="u-rol">Rol</label>
                <select id="u-rol" value={uRol} onChange={(e) => setURol(e.target.value)}>
                  <OpcionesRol propios={rolesPropios.data ?? []} />
                </select>
              </div>
              <div>
                <label htmlFor="u-clave">Contraseña (opcional)</label>
                <CampoClave id="u-clave" valor={uClave} onCambio={setUClave} />
              </div>
            </div>
            <p className="meta" style={{ marginTop: 8 }}>
              <strong>Descuento máximo</strong> es el tope (%) que ese usuario puede ofrecer en una
              cotización. Vacío = usa el de la organización (Embudo → Descuentos). Los precios de lista
              solo los cambian gerentes y administradores, y cada cambio queda en el registro.
            </p>
            <p className="meta" style={{ marginTop: 8 }}>
              Si le pones contraseña, se la pasas tú y entra con correo y contraseña. Si la dejas
              vacía, la primera vez entra con un enlace enviado a ese correo (tiene que ser un buzón
              real) y luego crea su contraseña en Mi cuenta. Con «Contraseña» en cada fila puedes
              cambiársela cuando la olvide o deje el equipo: sus sesiones abiertas se cierran. Los usuarios no se borran, se
              desactivan: aparecen en asignaciones, actividades y auditoría, y borrarlos dejaría el
              historial sin dueño. Un asesor inactivo no puede entrar ni recibe leads nuevos.
            </p>
            {crearUsuario.isError && (
              <p className="error">{(crearUsuario.error as Error).message}</p>
            )}
            {cambiarUsuario.isError && (
              <p className="error">{(cambiarUsuario.error as Error).message}</p>
            )}
            <div className="acciones">
              <button
                type="submit"
                className="btn"
                disabled={
                  !uNombre.trim() ||
                  !uCorreo.trim() ||
                  (uClave.length > 0 && uClave.length < PASSWORD_MIN) ||
                  crearUsuario.isPending
                }
              >
                {crearUsuario.isPending ? 'Creando…' : 'Añadir usuario'}
              </button>
            </div>
          </form>
        </div>
      )}

      {seccion === 'meta' && <MetaLeadAds />}

      {seccion === 'whatsapp' && (
        <>
          <WhatsAppNumeros />
          <PlantillasWhatsApp />
        </>
      )}

      {seccion === 'voz' && <AjustesVoz />}

      {seccion === 'roles' && <Roles />}

      {seccion === 'sperant' && <MigracionSperant />}

      {seccion === 'diagnostico' && <Diagnostico />}

      {seccion === 'respaldos' && <Respaldos />}

      {seccion === 'registro' && <Registro />}

      {seccion === 'exportar' && (
        <div className="card">
          <strong>Exportar</strong>
          <p className="meta" style={{ marginTop: 6 }}>
            La descarga queda registrada en la auditoría: quién, cuándo y cuántos registros.
          </p>
          <a className="btn btn-sec" href="/api/v1/leads/export">
            Descargar leads en CSV
          </a>
        </div>
      )}
    </>
  );
}


/** Contraseña visible (la va a dictar o copiar el administrador) con botón para generar una. */
function CampoClave({ id, valor, onCambio }: { id: string; valor: string; onCambio: (v: string) => void }) {
  return (
    <>
      <span style={{ display: 'flex', gap: 6 }}>
        <input
          id={id}
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
          placeholder={`mínimo ${PASSWORD_MIN} caracteres`}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-sec" onClick={() => onCambio(generarClave())}>
          Generar
        </button>
      </span>
      {valor.length > 0 && valor.length < PASSWORD_MIN && (
        <span className="meta">Faltan {PASSWORD_MIN - valor.length} caracteres</span>
      )}
    </>
  );
}

/** Clave aleatoria legible: sin 0/O ni 1/l/I, para dictarla sin confusiones. */
function generarClave(largo = 12) {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const azar = crypto.getRandomValues(new Uint32Array(largo));
  return Array.from(azar, (n) => letras[n % letras.length]).join('');
}

/** Asignar o cambiar la contraseña de otro usuario, desplegado bajo su fila. */
function ClaveUsuario({ id, nombre, tiene, onListo }: { id: string; nombre: string; tiene: boolean; onListo: () => void }) {
  const [clave, setClave] = useState('');
  const guardar = useMutation({
    mutationFn: () => api.put(`/users/${id}/password`, { password: clave }),
    onSuccess: onListo,
  });
  return (
    <div style={{ marginTop: 8, textAlign: 'left', minWidth: 260 }}>
      <label htmlFor={`clave-${id}`}>{tiene ? 'Nueva contraseña' : 'Contraseña'} para {nombre}</label>
      <CampoClave id={`clave-${id}`} valor={clave} onCambio={setClave} />
      {tiene && <p className="meta">Reemplaza la actual y cierra sus sesiones abiertas.</p>}
      {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
      <button
        type="button"
        className="btn"
        style={{ marginTop: 6 }}
        disabled={clave.length < PASSWORD_MIN || guardar.isPending}
        onClick={() => guardar.mutate()}
      >
        {guardar.isPending ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </div>
  );
}

/** Campo de porcentaje que guarda al salir o con Enter; vacío = sin tope propio. */
function DescuentoUsuario({
  valor,
  disabled,
  onGuardar,
}: {
  valor: string | null;
  disabled: boolean;
  onGuardar: (v: number | null) => void;
}) {
  const [texto, setTexto] = useState(valor == null ? '' : String(Number(valor)));
  const inicial = valor == null ? '' : String(Number(valor));
  function guardar() {
    const t = texto.trim();
    if (t === inicial) return;
    if (t === '') return onGuardar(null);
    const n = Number(t.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n <= 100) onGuardar(Math.round(n * 100) / 100);
    else setTexto(inicial);
  }
  return (
    <span className="porcentaje">
      <input
        type="text"
        inputMode="decimal"
        value={texto}
        placeholder="org."
        disabled={disabled}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        aria-label="Descuento máximo en porcentaje"
        style={{ width: 64, textAlign: 'right' }}
      />
      <span className="meta">%</span>
    </span>
  );
}


/**
 * El valor del desplegable mezcla roles base (`gerente`) y personalizados (`custom:<id>`).
 * Elegir uno personalizado deja el rol base en `asesor` como respaldo si el rol se borra.
 */
function rolAPayload(valor?: string) {
  if (!valor) return {};
  if (valor.startsWith('custom:')) return { role: 'asesor', customRoleId: valor.slice(7) };
  return { role: valor, customRoleId: null };
}

function OpcionesRol({ propios }: { propios: { id: string; name: string }[] }) {
  return (
    <>
      <optgroup label="Roles base">
        {Object.entries(ROLES).map(([valor, etiqueta]) => (
          <option key={valor} value={valor}>{etiqueta}</option>
        ))}
      </optgroup>
      {propios.length > 0 && (
        <optgroup label="Roles de la organización">
          {propios.map((r) => <option key={r.id} value={`custom:${r.id}`}>{r.name}</option>)}
        </optgroup>
      )}
    </>
  );
}
