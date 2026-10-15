/**
 * Ajustes → Migración Sperant.
 *
 * Tres pasos en una sola pantalla, en orden: conectar (token), exportar (tarda ~25 min, se
 * ve el avance), importar (primero simular, después de verdad). El mapa de etapas y asesores
 * lo decide la persona; el servidor solo propone.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Conteo { valor: string; n: number }

interface EstadoResp {
  config: { tokenHint: string | null; sperantProjectId: number | null };
  estado: {
    fase: 'sin_token' | 'listo' | 'exportando' | 'exportado' | 'importando' | 'importado' | 'error';
    tarea?: 'exportar' | 'importar';
    inicio?: string; fin?: string; latido?: string; total?: number; hechos?: number; error?: string | null;
    enCurso: boolean; hayDatos: boolean;
    importe?: Informe;
  };
  resumen: {
    exportadoEl: string;
    leads: {
      total: number; desde: string | null; hasta: string | null; porMes: Conteo[]; proyectos: Conteo[]; etapas: Conteo[];
      asesores: Conteo[]; canales: Conteo[]; medios: Conteo[]; interes: Conteo[]; motivos: Conteo[];
      sinTelefono: number; sinCorreo: number; sinDocumento: number; conObservacion: number; sinNumeroWhatsApp: number;
    };
    inventario: { tipologias: string[]; unidades: number; porEstado: Conteo[]; porTipo: Conteo[] };
    proformas: { total: number; activas: number; financiamiento: Conteo[] };
    usuarios: { username: string; nombre: string; email: string }[];
  } | null;
  sugerencia: {
    etapas: Record<string, string | null>;
    asesores: Record<string, string | null>;
    etapasCrm: { id: string; name: string; isLost: boolean; isWon: boolean }[];
    usuariosCrm: { id: string; email: string; name: string }[];
  } | null;
  proyectosCrm: { id: string; name: string }[];
}

interface Informe {
  simulacion: boolean;
  leads: { total: number; nuevos: number; fusionados: number; yaImportados: number; omitidos: number; sinEtapa: number; sinAsesor: number; errores: number };
  contactos: { nuevos: number; existentes: number };
  unidades: { creadas: number; actualizadas: number; tipologiasCreadas: number };
  proformas: { notas: number };
  etapasCreadas: string[];
  erroresDetalle: { clientId: number; motivo: string }[];
}

const FASE: Record<EstadoResp['estado']['fase'], string> = {
  sin_token: 'Sin conectar',
  listo: 'Conectado',
  exportando: 'Exportando…',
  exportado: 'Exportado',
  importando: 'Importando…',
  importado: 'Importado',
  error: 'Error',
};

function Tabla({ titulo, filas, max = 8 }: { titulo: string; filas: Conteo[]; max?: number }) {
  const [todo, setTodo] = useState(false);
  const ver = todo ? filas : filas.slice(0, max);
  return (
    <div>
      <strong style={{ fontSize: 13 }}>{titulo}</strong>
      <table className="tabla-compacta" style={{ marginTop: 4 }}>
        <tbody>
          {ver.map((f) => (
            <tr key={f.valor}><td>{f.valor}</td><td style={{ textAlign: 'right' }}>{f.n.toLocaleString('es-PE')}</td></tr>
          ))}
        </tbody>
      </table>
      {filas.length > max && (
        <button type="button" className="enlace-btn" onClick={() => setTodo(!todo)}>{todo ? 'Ver menos' : `Ver las ${filas.length}`}</button>
      )}
    </div>
  );
}

export default function MigracionSperant() {
  const qc = useQueryClient();
  const estado = useQuery({
    queryKey: ['sperant-estado'],
    queryFn: () => api.get<EstadoResp>('/sperant/estado'),
    refetchInterval: (q) => (q.state.data?.estado.enCurso ? 3_000 : false),
  });
  const d = estado.data;

  const [token, setToken] = useState('');
  const [sperantProjectId, setSperantProjectId] = useState<string>('');
  const [prueba, setPrueba] = useState<{ ok: boolean; proyectos?: { id: number; code: string; name: string }[]; totalLeads?: number; error?: string } | null>(null);

  const [crmProjectId, setCrmProjectId] = useState('');
  const [etapas, setEtapas] = useState<Record<string, string | null>>({});
  const [asesores, setAsesores] = useState<Record<string, string | null>>({});
  const [importarUnidades, setImportarUnidades] = useState(true);
  const [importarProformas, setImportarProformas] = useState(true);
  const [informe, setInforme] = useState<Informe | null>(null);

  // La sugerencia del servidor rellena el mapa una vez; después manda lo que toque la persona.
  useEffect(() => {
    if (!d?.sugerencia) return;
    setEtapas((prev) => (Object.keys(prev).length ? prev : d.sugerencia!.etapas));
    setAsesores((prev) => (Object.keys(prev).length ? prev : d.sugerencia!.asesores));
    setCrmProjectId((prev) => prev || (d.proyectosCrm[0]?.id ?? ''));
    setSperantProjectId((prev) => prev || (d.config.sperantProjectId ? String(d.config.sperantProjectId) : ''));
  }, [d]);

  const guardar = useMutation({
    mutationFn: () => api.put('/sperant/config', { ...(token.trim() ? { token: token.trim() } : {}), sperantProjectId: sperantProjectId ? Number(sperantProjectId) : null }),
    onSuccess: () => { setToken(''); qc.invalidateQueries({ queryKey: ['sperant-estado'] }); },
  });
  const probar = useMutation({
    mutationFn: () => api.post<NonNullable<typeof prueba>>('/sperant/probar'),
    onSuccess: setPrueba,
    onError: (e: Error) => setPrueba({ ok: false, error: e.message }),
  });
  const exportar = useMutation({
    mutationFn: () => api.post('/sperant/exportar'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sperant-estado'] }),
  });
  const cuerpo = (simulacion: boolean) => ({ simulacion, crmProjectId, etapas, asesores, importarUnidades, importarProformas });
  const simular = useMutation({
    mutationFn: () => api.post<Informe>('/sperant/importar', cuerpo(true)),
    onSuccess: setInforme,
  });
  const importarReal = useMutation({
    mutationFn: () => api.post('/sperant/importar', cuerpo(false)),
    onSuccess: () => { setInforme(null); qc.invalidateQueries({ queryKey: ['sperant-estado'] }); },
  });
  const borrar = useMutation({
    mutationFn: () => api.del('/sperant/datos'),
    onSuccess: () => { setInforme(null); qc.invalidateQueries({ queryKey: ['sperant-estado'] }); },
  });

  const avance = useMemo(() => {
    if (!d?.estado.total) return null;
    return Math.round(((d.estado.hechos ?? 0) / d.estado.total) * 100);
  }, [d]);

  if (!d) return <p className="meta">Cargando…</p>;
  const r = d.resumen;
  const sug = d.sugerencia;
  const enCurso = d.estado.enCurso;
  const listoParaImportar = d.estado.hayDatos && !enCurso && crmProjectId;

  return (
    <>
      {/* 1 · Conexión */}
      <div className="card">
        <strong>1 · Conexión con Sperant</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Token de la API v3 (el mismo que usa el plugin de la web). Se guarda cifrado y no vuelve a mostrarse.
          {d.config.tokenHint && <> Token cargado: <code>…{d.config.tokenHint}</code>.</>}
        </p>
        <form onSubmit={(e) => { e.preventDefault(); guardar.mutate(); }} className="fila-form">
          <div>
            <label htmlFor="sp-token">{d.config.tokenHint ? 'Nuevo token (opcional)' : 'Token'}</label>
            <input id="sp-token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Pegar el token" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="sp-proy">Proyecto en Sperant (id)</label>
            <input id="sp-proy" inputMode="numeric" value={sperantProjectId} onChange={(e) => setSperantProjectId(e.target.value)} placeholder="2" style={{ width: 90 }} />
          </div>
          <button className="btn" disabled={guardar.isPending || (!token.trim() && !d.config.tokenHint)}>Guardar</button>
          <button type="button" className="btn btn-sec" disabled={!d.config.tokenHint || probar.isPending} onClick={() => probar.mutate()}>Probar</button>
        </form>
        {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
        {prueba && (prueba.ok ? (
          <p className="ok">
            Conecta. {prueba.totalLeads?.toLocaleString('es-PE')} leads. Proyectos: {prueba.proyectos?.map((p) => `${p.name} (id ${p.id}, ${p.code})`).join(' · ')}.
            {!sperantProjectId && prueba.proyectos?.length ? ' Escribe arriba el id del proyecto a migrar y guarda.' : ''}
          </p>
        ) : <p className="error">{prueba.error}</p>)}
      </div>

      {/* 2 · Exportación */}
      <div className="card">
        <strong>2 · Exportar desde Sperant</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Baja leads, etapa, asesor, canal, inventario y proformas a un archivo privado del servidor. Son dos
          peticiones por lead: unos 25 minutos para 1.700. Si se corta, «Continuar» retoma donde quedó.
        </p>
        <p style={{ margin: '8px 0' }}>
          <span className={`chip ${d.estado.fase === 'error' ? 'chip-rojo' : enCurso ? 'chip-alerta' : d.estado.hayDatos ? '' : 'chip-gris'}`}>{FASE[d.estado.fase]}</span>
          {enCurso && d.estado.tarea === 'exportar' && (
            <span className="meta" style={{ marginLeft: 8 }}>
              {d.estado.hechos ?? 0}{d.estado.total ? ` / ${d.estado.total}` : ''} leads{avance !== null ? ` (${avance} %)` : ''}
            </span>
          )}
          {!enCurso && r && <span className="meta" style={{ marginLeft: 8 }}>Último export: {new Date(r.exportadoEl).toLocaleString('es-PE')}</span>}
        </p>
        {d.estado.error && <p className="error">{d.estado.error}</p>}
        <div className="acciones">
          <button type="button" className="btn" disabled={!d.config.tokenHint || enCurso || exportar.isPending} onClick={() => exportar.mutate()}>
            {d.estado.fase === 'error' && d.estado.tarea === 'exportar' ? 'Continuar' : d.estado.hayDatos ? 'Exportar de nuevo (trae lo nuevo)' : 'Exportar'}
          </button>
          {d.estado.hayDatos && !enCurso && (
            <button type="button" className="btn btn-sec" disabled={borrar.isPending} onClick={() => { if (confirm('¿Borrar el archivo exportado? Los leads ya importados se quedan en el CRM.')) borrar.mutate(); }}>Borrar export</button>
          )}
        </div>
        {exportar.isError && <p className="error">{(exportar.error as Error).message}</p>}

        {r && (
          <div className="rejilla-resumen" style={{ marginTop: 14 }}>
            <div>
              <strong style={{ fontSize: 13 }}>Leads</strong>
              <p className="meta" style={{ marginTop: 4 }}>
                {r.leads.total.toLocaleString('es-PE')} · del {r.leads.desde?.slice(0, 10)} al {r.leads.hasta?.slice(0, 10)}<br />
                sin teléfono {r.leads.sinTelefono} · sin correo {r.leads.sinCorreo} · sin DNI {r.leads.sinDocumento} · sin número de WhatsApp {r.leads.sinNumeroWhatsApp}
              </p>
              <Tabla titulo="Por mes" filas={r.leads.porMes} max={12} />
            </div>
            <Tabla titulo="Etapa en Sperant" filas={r.leads.etapas} />
            <Tabla titulo="Asesor" filas={r.leads.asesores} />
            <Tabla titulo="Motivo de descarte" filas={r.leads.motivos} />
            <Tabla titulo="Canal" filas={r.leads.canales} />
            <Tabla titulo="Medio" filas={r.leads.medios} />
            <div>
              <strong style={{ fontSize: 13 }}>Inventario y proformas</strong>
              <p className="meta" style={{ marginTop: 4 }}>
                {r.inventario.unidades} unidades · tipologías {r.inventario.tipologias.join(', ')}<br />
                {r.inventario.porEstado.map((x) => `${x.valor} ${x.n}`).join(' · ')}<br />
                {r.proformas.total} proformas ({r.proformas.activas} activas)
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 3 · Importación */}
      {r && sug && (
        <div className="card">
          <strong>3 · Importar al CRM</strong>
          <p className="meta" style={{ marginTop: 6 }}>
            Cada lead entra con su fecha original, su etapa, su asesor y su motivo de descarte. Si un contacto ya tiene un lead
            activo en el proyecto (por ejemplo, entró por WhatsApp durante el demo), se fusiona en vez de duplicarse. Se puede
            repetir: los ya importados se saltan.
          </p>

          <label htmlFor="sp-crm-proy" style={{ marginTop: 10 }}>Proyecto del CRM</label>
          <select id="sp-crm-proy" value={crmProjectId} onChange={(e) => setCrmProjectId(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Elegir…</option>
            {d.proyectosCrm.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <div className="rejilla-mapa" style={{ marginTop: 14 }}>
            <div>
              <strong style={{ fontSize: 13 }}>Etapas</strong>
              <p className="meta">Etapa de Sperant → etapa del CRM. «Crear» la agrega con el mismo nombre.</p>
              {r.leads.etapas.map((e) => (
                <div key={e.valor} className="fila-mapa">
                  <span>{e.valor} <span className="meta">({e.n})</span></span>
                  <select value={etapas[e.valor] ?? ''} onChange={(ev) => setEtapas({ ...etapas, [e.valor]: ev.target.value === '' ? null : ev.target.value })}>
                    <option value="">No importar estos leads</option>
                    <option value="crear">Crear etapa «{e.valor}»</option>
                    <option value="crear_perdida">Crear etapa «{e.valor}» como perdida</option>
                    {sug.etapasCrm.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isLost ? ' (perdida)' : c.isWon ? ' (ganada)' : ''}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div>
              <strong style={{ fontSize: 13 }}>Asesores</strong>
              <p className="meta">Usuario de Sperant → usuario del CRM. Sin dueño = se reparte después a mano.</p>
              {r.leads.asesores.map((a) => {
                const su = r.usuarios.find((u) => u.username === a.valor);
                return (
                  <div key={a.valor} className="fila-mapa">
                    <span>{a.valor}{su ? <span className="meta"> · {su.nombre} · {su.email}</span> : null} <span className="meta">({a.n})</span></span>
                    <select value={asesores[a.valor] ?? ''} onChange={(ev) => setAsesores({ ...asesores, [a.valor]: ev.target.value || null })}>
                      <option value="">Sin dueño</option>
                      {sug.usuariosCrm.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.email}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>

          <label className="casilla" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={importarUnidades} onChange={(e) => setImportarUnidades(e.target.checked)} />
            <span>Traer también tipologías y unidades (precio y estado actuales de Sperant; actualiza las que ya existan por código)</span>
          </label>
          <label className="casilla">
            <input type="checkbox" checked={importarProformas} onChange={(e) => setImportarProformas(e.target.checked)} />
            <span>Anotar las proformas emitidas en Sperant como notas en la ficha (no se recrean como proformas del CRM)</span>
          </label>

          <div className="acciones" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-sec" disabled={!listoParaImportar || simular.isPending} onClick={() => simular.mutate()}>
              {simular.isPending ? 'Simulando…' : 'Simular'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!listoParaImportar || !informe || importarReal.isPending}
              title={!informe ? 'Primero simula' : ''}
              onClick={() => { if (confirm(`Se van a crear ${informe?.leads.nuevos} leads y fusionar ${informe?.leads.fusionados}. ¿Continuar?`)) importarReal.mutate(); }}
            >
              Importar de verdad
            </button>
          </div>
          {simular.isError && <p className="error">{(simular.error as Error).message}</p>}
          {importarReal.isError && <p className="error">{(importarReal.error as Error).message}</p>}

          {enCurso && d.estado.tarea === 'importar' && (
            <p className="meta" style={{ marginTop: 8 }}>Importando… {d.estado.hechos ?? 0}{d.estado.total ? ` / ${d.estado.total}` : ''}</p>
          )}

          {(informe ?? d.estado.importe) && <ResultadoImporte informe={(informe ?? d.estado.importe)!} />}
        </div>
      )}
    </>
  );
}

function ResultadoImporte({ informe: i }: { informe: Informe }) {
  return (
    <div className="resultado-importe">
      <strong style={{ fontSize: 13 }}>{i.simulacion ? 'Simulación (no se escribió nada)' : 'Resultado de la importación'}</strong>
      <table className="tabla-compacta" style={{ marginTop: 6 }}>
        <tbody>
          <tr><td>Leads en el export</td><td>{i.leads.total}</td></tr>
          <tr><td>Leads nuevos</td><td>{i.leads.nuevos}</td></tr>
          <tr><td>Fusionados con un lead activo existente</td><td>{i.leads.fusionados}</td></tr>
          <tr><td>Ya importados antes (se saltan)</td><td>{i.leads.yaImportados}</td></tr>
          <tr><td>Omitidos por el mapa de etapas</td><td>{i.leads.omitidos}</td></tr>
          <tr><td>Sin etapa en el mapa (quedan sin etapa)</td><td>{i.leads.sinEtapa}</td></tr>
          <tr><td>Sin asesor</td><td>{i.leads.sinAsesor}</td></tr>
          <tr><td>Contactos nuevos / ya existentes</td><td>{i.contactos.nuevos} / {i.contactos.existentes}</td></tr>
          <tr><td>Unidades creadas / actualizadas · tipologías nuevas</td><td>{i.unidades.creadas} / {i.unidades.actualizadas} · {i.unidades.tipologiasCreadas}</td></tr>
          <tr><td>Notas de proformas</td><td>{i.proformas.notas}</td></tr>
          <tr><td>Etapas que se crean</td><td>{i.etapasCreadas.join(', ') || 'ninguna'}</td></tr>
          <tr><td>Errores</td><td>{i.leads.errores}</td></tr>
        </tbody>
      </table>
      {i.erroresDetalle.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="meta">Ver errores</summary>
          <ul className="meta">{i.erroresDetalle.map((e) => <li key={e.clientId}>#{e.clientId}: {e.motivo}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
