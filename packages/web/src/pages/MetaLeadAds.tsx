/**
 * Conexión con Meta Lead Ads, dentro de Ajustes.
 *
 * Lo que esta pantalla tiene que dejar ver de un vistazo es si el canal está entrando o
 * no. El fallo típico —el page access token caducó— es silencioso: Meta sigue mandando
 * avisos y el CRM sigue respondiendo 200, pero ningún lead llega. De ahí el botón de
 * probar y la lista de últimos avisos con su estado.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Pagina {
  id: string;
  pageId: string;
  pageName: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  formMap: Record<string, string> | null;
  notifyEmails: string[] | null;
  active: boolean;
  lastLeadAt: string | null;
  lastError: string | null;
  tokenHint: string | null;
}

interface Aviso {
  id: string;
  leadgenId: string;
  metaFormId: string | null;
  campaignId: string | null;
  platform: string | null;
  status: 'recibido' | 'procesado' | 'fallido' | 'descartado';
  error: string | null;
  leadId: string | null;
  createdAt: string;
}

interface Prueba {
  ok: boolean;
  error?: string;
  pageName?: string;
  forms?: Array<{ id: string; name: string; status?: string }>;
}

const CHIP: Record<Aviso['status'], string> = {
  procesado: 'chip',
  recibido: 'chip chip-gris',
  fallido: 'chip chip-rojo',
  descartado: 'chip chip-gris',
};

export default function MetaLeadAds() {
  const qc = useQueryClient();
  // El retorno de Facebook llega como navegación a esta misma URL con el resultado en los
  // parámetros; se muestra una vez y se limpia para que recargar no lo repita.
  const [params, setParams] = useSearchParams();
  const retorno = params.get('meta');
  const [proyectoOAuth, setProyectoOAuth] = useState('');
  const oauth = useQuery({
    queryKey: ['meta-oauth-estado'],
    queryFn: () => api.get<{ disponible: boolean; redirectUri: string }>('/meta/oauth/estado'),
  });
  const cerrarRetorno = () => {
    const p = new URLSearchParams(params);
    for (const k of ['meta', 'conectadas', 'ajenas', 'sinSuscribir', 'detalle']) p.delete(k);
    setParams(p, { replace: true });
  };
  const [pageId, setPageId] = useState('');
  const [pageName, setPageName] = useState('');
  const [token, setToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [correos, setCorreos] = useState('');
  const [prueba, setPrueba] = useState<{ id: string; resultado: Prueba } | null>(null);
  /** Token nuevo escrito por página, hasta que se guarda explícitamente. */
  const [tokenNuevo, setTokenNuevo] = useState<Record<string, string>>({});

  const paginas = useQuery({ queryKey: ['meta-pages'], queryFn: () => api.get<Pagina[]>('/meta/pages') });
  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });
  const avisos = useQuery({
    queryKey: ['meta-leads'],
    queryFn: () => api.get<{ avisos: Aviso[] }>('/meta/leads'),
    // El lead entra segundos después del aviso: sin refresco, la pantalla miente.
    refetchInterval: 20_000,
  });

  const limpiar = () => {
    setPageId(''); setPageName(''); setToken(''); setProjectId(''); setCorreos('');
  };

  const conectar = useMutation({
    mutationFn: () =>
      api.post('/meta/pages', {
        pageId: pageId.trim(),
        pageName: pageName.trim(),
        accessToken: token.trim(),
        projectId: projectId || null,
        notifyEmails: correos.split(',').map((c) => c.trim()).filter(Boolean),
      }),
    onSuccess: () => { limpiar(); qc.invalidateQueries({ queryKey: ['meta-pages'] }); },
  });

  const actualizar = useMutation({
    mutationFn: (v: { id: string; datos: Record<string, unknown> }) =>
      api.patch(`/meta/pages/${v.id}`, v.datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-pages'] }),
  });

  const desconectar = useMutation({
    mutationFn: (id: string) => api.del(`/meta/pages/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-pages'] }),
  });

  const probar = useMutation({
    mutationFn: (id: string) => api.get<Prueba>(`/meta/pages/${id}/test`),
    onSuccess: (resultado, id) => {
      setPrueba({ id, resultado });
      qc.invalidateQueries({ queryKey: ['meta-pages'] });
    },
  });

  const reintentar = useMutation({
    mutationFn: (id: string) => api.post(`/meta/leads/${id}/retry`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meta-leads'] }),
  });

  return (
    <>
      <div className="card">
        <strong>Meta Lead Ads</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Los formularios instantáneos de Facebook e Instagram entran como leads igual que los
          de la web: con deduplicación, asignación al asesor y aviso por correo. Meta avisa al
          CRM y el CRM va a buscar los datos; por eso hace falta el <strong>page access token</strong>
          {' '}de la página, que se guarda cifrado y no se vuelve a mostrar.
        </p>

        {retorno === 'ok' && (
          <div className="card" style={{ marginTop: 10, borderColor: '#10b981' }}>
            <strong>Página conectada: {(params.get('conectadas') ?? '').split('|').filter(Boolean).join(', ')}</strong>
            <p className="meta" style={{ marginTop: 6 }}>
              El CRM ya tiene el token y quedó suscrito a los formularios instantáneos. Pulsa
              «Probar conexión» para ver los formularios y asignarlos a sus proyectos.
            </p>
            {params.get('ajenas') && (
              <p className="error">
                {params.get('ajenas')} página(s) no se conectaron porque ya están en uso en otra cuenta.
              </p>
            )}
            {params.get('sinSuscribir') && (
              <p className="error">
                No se pudo suscribir la app a: {(params.get('sinSuscribir') ?? '').split('|').join(', ')}.
                Los leads no llegarán hasta resolverlo; el detalle está en la ficha de la página.
              </p>
            )}
            <div className="acciones" style={{ marginTop: 8 }}>
              <button className="btn btn-sec" onClick={cerrarRetorno}>Entendido</button>
            </div>
          </div>
        )}
        {retorno === 'error' && (
          <div className="card" style={{ marginTop: 10, borderColor: '#dc2626' }}>
            <p className="error">No se pudo conectar con Facebook: {params.get('detalle')}</p>
            <div className="acciones" style={{ marginTop: 8 }}>
              <button className="btn btn-sec" onClick={cerrarRetorno}>Cerrar</button>
            </div>
          </div>
        )}

        {oauth.data?.disponible && (
          <div className="card" style={{ background: '#f4f7fd', marginTop: 10 }}>
            <strong>Conectar una página</strong>
            <p className="meta" style={{ marginTop: 6 }}>
              Se abre una ventana de Facebook donde eliges la página y aceptas los permisos.
              El CRM guarda el acceso cifrado y se suscribe solo a los formularios: no hay
              que copiar ningún token.
            </p>
            <label htmlFor="m-oauth-proyecto">Proyecto por defecto para sus leads</label>
            <select
              id="m-oauth-proyecto"
              value={proyectoOAuth}
              onChange={(e) => setProyectoOAuth(e.target.value)}
            >
              <option value="">Sin proyecto</option>
              {proyectos.data?.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
            <div className="acciones" style={{ marginTop: 12 }}>
              <a
                className="btn"
                href={`/api/v1/meta/oauth/start${proyectoOAuth ? `?projectId=${encodeURIComponent(proyectoOAuth)}` : ''}`}
              >
                Conectar con Facebook
              </a>
            </div>
          </div>
        )}

        {paginas.data?.length === 0 && (
          <p className="meta">Todavía no hay ninguna página conectada.</p>
        )}

        {paginas.data?.map((p) => (
          <div key={p.id} className="card" style={{ background: '#fafbfc', marginTop: 10 }}>
            <div className="fila">
              <span className="nombre">{p.pageName}</span>
              <span className={p.active ? 'chip' : 'chip chip-gris'}>
                {p.active ? 'activa' : 'pausada'}
              </span>
            </div>
            <label>ID de la página</label>
            <div className="codigo">{p.pageId}</div>
            <p className="meta">
              Token: {p.tokenHint ?? 'no se pudo leer'} ·{' '}
              {p.lastLeadAt
                ? `último lead ${new Date(p.lastLeadAt).toLocaleString('es-PE')}`
                : 'sin leads todavía'}
            </p>

            {p.lastError && (
              <p className="error">
                Último error de Meta: {p.lastError}
                <br />
                Suele ser el token: vuelve a generarlo en Meta y pégalo abajo.
              </p>
            )}

            <label>Proyecto por defecto</label>
            <select
              value={p.projectId ?? ''}
              onChange={(e) => actualizar.mutate({ id: p.id, datos: { projectId: e.target.value || null } })}
            >
              <option value="">Sin proyecto</option>
              {proyectos.data?.map((pr) => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>

            <label htmlFor={`token-${p.id}`}>Reemplazar el token</label>
            <input
              id={`token-${p.id}`}
              type="password"
              placeholder="Pegar un page access token nuevo"
              value={tokenNuevo[p.id] ?? ''}
              onChange={(e) => setTokenNuevo((t) => ({ ...t, [p.id]: e.target.value }))}
            />
            <p className="meta">
              Sirve un token de usuario o de página del Explorador de Meta: el CRM canjea el de
              la página. {oauth.data?.disponible && 'Más fácil: volver a pulsar «Conectar con Facebook» arriba renueva el token sin pegar nada.'}
            </p>

            <div className="acciones" style={{ marginTop: 12 }}>
              {/*
                Guardar es un botón y no el `onBlur` que había antes. Con `onBlur`, pulsar
                «Probar conexión» disparaba las dos peticiones a la vez y la prueba salía con
                el token viejo: parecía que el token nuevo estaba mal cuando el problema era
                el orden. Ahora se guarda y, solo cuando el servidor confirma, se prueba.
              */}
              <button
                className="btn btn-sec"
                disabled={!(tokenNuevo[p.id] ?? '').trim() || actualizar.isPending}
                onClick={() =>
                  actualizar.mutate(
                    { id: p.id, datos: { accessToken: (tokenNuevo[p.id] ?? '').trim() } },
                    {
                      onSuccess: () => {
                        setTokenNuevo((t) => ({ ...t, [p.id]: '' }));
                        probar.mutate(p.id);
                      },
                    }
                  )
                }
              >
                {actualizar.isPending ? 'Guardando…' : 'Guardar token y probar'}
              </button>
              <button
                className="btn btn-sec"
                onClick={() => probar.mutate(p.id)}
                disabled={probar.isPending || actualizar.isPending}
              >
                {probar.isPending ? 'Probando…' : 'Probar conexión'}
              </button>
              <button
                className="btn btn-sec"
                onClick={() => actualizar.mutate({ id: p.id, datos: { active: !p.active } })}
              >
                {p.active ? 'Pausar' : 'Reanudar'}
              </button>
              <button
                className="btn btn-sec"
                onClick={() => {
                  if (confirm(`¿Desconectar ${p.pageName}? Los leads ya recibidos se quedan.`)) {
                    desconectar.mutate(p.id);
                  }
                }}
              >
                Desconectar
              </button>
            </div>

            {prueba?.id === p.id && (
              <div className="card" style={{ marginTop: 10, borderColor: prueba.resultado.ok ? '#10b981' : '#dc2626' }}>
                {prueba.resultado.ok ? (
                  <>
                    <strong>Conexión correcta: {prueba.resultado.pageName}</strong>
                    <p className="meta" style={{ marginTop: 6 }}>
                      Cada formulario instantáneo puede ir a un proyecto distinto. Lo que se
                      deje sin elegir usa el proyecto por defecto de arriba.
                    </p>
                    <table className="tabla tabla-movil" style={{ marginTop: 8 }}>
                      <thead><tr><th>Formulario</th><th>Proyecto</th></tr></thead>
                      <tbody>
                        {prueba.resultado.forms?.map((f) => (
                          <tr key={f.id}>
                            <td>
                              {f.name}
                              {f.status && f.status !== 'ACTIVE' && (
                                <span className="chip chip-gris" style={{ marginLeft: 6 }}>
                                  {f.status.toLowerCase()}
                                </span>
                              )}
                            </td>
                            <td>
                              <select
                                value={p.formMap?.[f.id] ?? ''}
                                onChange={(e) => {
                                  const mapa = { ...(p.formMap ?? {}) };
                                  if (e.target.value) mapa[f.id] = e.target.value;
                                  else delete mapa[f.id];
                                  actualizar.mutate({ id: p.id, datos: { formMap: mapa } });
                                }}
                              >
                                <option value="">Por defecto</option>
                                {proyectos.data?.map((pr) => (
                                  <option key={pr.id} value={pr.id}>{pr.name}</option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {prueba.resultado.forms?.length === 0 && (
                      <p className="meta">Esta página todavía no tiene formularios instantáneos.</p>
                    )}
                  </>
                ) : (
                  <p className="error">No se pudo conectar: {prueba.resultado.error}</p>
                )}
              </div>
            )}
          </div>
        ))}

        <details
          open={!oauth.data?.disponible}
          style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
        >
          <summary className="meta" style={{ cursor: 'pointer' }}>
            {oauth.data?.disponible
              ? 'Conectar a mano con un token (respaldo)'
              : 'Conectar una página con su token'}
          </summary>
        <form
          style={{ marginTop: 10 }}
          onSubmit={(e) => { e.preventDefault(); conectar.mutate(); }}
        >
          <div className="rejilla-2">
            <div>
              <label htmlFor="m-id">ID de la página de Facebook</label>
              <input id="m-id" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="102938475601234" />
            </div>
            <div>
              <label htmlFor="m-nombre">Nombre de la página</label>
              <input id="m-nombre" value={pageName} onChange={(e) => setPageName(e.target.value)} />
            </div>
          </div>
          <label htmlFor="m-token">Page access token</label>
          <input id="m-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
          <label htmlFor="m-proyecto">Proyecto por defecto</label>
          <select id="m-proyecto" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Sin proyecto</option>
            {proyectos.data?.map((pr) => (
              <option key={pr.id} value={pr.id}>{pr.name}</option>
            ))}
          </select>
          <label htmlFor="m-correos">Avisar a (correos separados por coma)</label>
          <input id="m-correos" value={correos} onChange={(e) => setCorreos(e.target.value)} />
          {conectar.isError && <p className="error">{(conectar.error as Error).message}</p>}
          <div className="acciones">
            <button
              type="submit"
              className="btn"
              disabled={!pageId.trim() || !pageName.trim() || token.trim().length < 20 || conectar.isPending}
            >
              {conectar.isPending ? 'Conectando…' : 'Conectar página'}
            </button>
          </div>
        </form>
        </details>
      </div>

      <div className="card">
        <strong>Últimos avisos de Meta</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Un aviso en <em>recibido</em> más de un minuto significa que el CRM no pudo traer los
          datos: casi siempre el token.
        </p>
        <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
          <thead><tr><th>Cuándo</th><th>Origen</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {avisos.data?.avisos.map((a) => (
              <tr key={a.id}>
                <td className="t-titulo">{new Date(a.createdAt).toLocaleString('es-PE')}</td>
                <td data-label="Origen">
                  {a.platform === 'ig' ? 'Instagram' : 'Facebook'}
                  {a.campaignId && <span className="meta"> · campaña {a.campaignId}</span>}
                </td>
                <td data-label="Estado">
                  <span className={CHIP[a.status]}>{a.status}</span>
                  {a.error && <div className="meta">{a.error}</div>}
                </td>
                <td className="accion">
                  {a.leadId ? (
                    <a className="btn btn-sec" href={`/leads/${a.leadId}`}>Ver lead</a>
                  ) : (
                    <button
                      className="btn btn-sec"
                      disabled={reintentar.isPending}
                      onClick={() => reintentar.mutate(a.id)}
                    >
                      Reintentar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {avisos.data?.avisos.length === 0 && <p className="meta">Todavía no llegó ningún aviso.</p>}
      </div>
    </>
  );
}
