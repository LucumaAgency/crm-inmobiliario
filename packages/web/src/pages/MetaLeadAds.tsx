/**
 * Conexión con Meta Lead Ads, dentro de Ajustes.
 *
 * Lo que esta pantalla tiene que dejar ver de un vistazo es si el canal está entrando o
 * no. El fallo típico —el page access token caducó— es silencioso: Meta sigue mandando
 * avisos y el CRM sigue respondiendo 200, pero ningún lead llega. De ahí el botón de
 * probar y la lista de últimos avisos con su estado.
 */
import { useState } from 'react';
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
              Tiene que ser un <strong>token de página</strong>, no de usuario. En el Explorador
              de Meta, elige la página en «Usuario o página» y vuelve a pulsar «Generate Access
              Token»: cambiar el desplegable no regenera el token de arriba.
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
                    <table className="tabla" style={{ marginTop: 8 }}>
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

        <form
          style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
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
      </div>

      <div className="card">
        <strong>Últimos avisos de Meta</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Un aviso en <em>recibido</em> más de un minuto significa que el CRM no pudo traer los
          datos: casi siempre el token.
        </p>
        <table className="tabla" style={{ marginTop: 10 }}>
          <thead><tr><th>Cuándo</th><th>Origen</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {avisos.data?.avisos.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString('es-PE')}</td>
                <td>
                  {a.platform === 'ig' ? 'Instagram' : 'Facebook'}
                  {a.campaignId && <span className="meta"> · campaña {a.campaignId}</span>}
                </td>
                <td>
                  <span className={CHIP[a.status]}>{a.status}</span>
                  {a.error && <div className="meta">{a.error}</div>}
                </td>
                <td>
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
