/**
 * Ajustes → Migración Sperant.
 *
 * Tres pasos en una sola pantalla, en orden: conectar (token), exportar (tarda ~25 min, se
 * ve el avance), importar (primero simular, después de verdad). El mapa de etapas y asesores
 * lo decide la persona; el servidor solo propone.
 */
import React, { useEffect, useMemo, useState } from 'react';
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
    proyectos: ProyectoSp[];
    sinProyecto: number;
    exportViejo: boolean;
    proformas: { total: number; activas: number; financiamiento: Conteo[] };
    usuarios: { username: string; nombre: string; email: string }[];
  } | null;
  sugerencia: {
    proyectos: Record<string, string | null>;
    etapas: Record<string, string | null>;
    asesores: Record<string, string | null>;
    etapasCrm: { id: string; name: string; isLost: boolean; isWon: boolean }[];
    usuariosCrm: { id: string; email: string; name: string }[];
  } | null;
  proyectosCrm: { id: string; name: string }[];
}

interface ProyectoSp {
  id: number; nombre: string; codigo: string | null; leads: number; unidades: number | null;
  tipologias: string[] | null; porEstado: Conteo[]; proformas: number; direccion: string | null;
}

interface Diferencia {
  clave: string;
  proyecto: string;
  code: string;
  cambios: Record<string, { crm: string | number | null; sperant: string | number | null }>;
  aprobada: boolean;
}

interface Informe {
  simulacion: boolean;
  leads: { total: number; nuevos: number; fusionados: number; yaImportados: number; omitidos: number; sinEtapa: number; sinAsesor: number; deProyectoNoImportado: number; sinProyecto: number; errores: number };
  proyectos: { sperant: string; crm: string | null; creado: boolean; leads: number; unidades: number }[];
  contactos: { nuevos: number; existentes: number };
  unidades: { creadas: number; actualizadas: number; sinCambios: number; pendientes: number; tipologiasCreadas: number; diferencias: Diferencia[] };
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
  const [prueba, setPrueba] = useState<{ ok: boolean; proyectos?: { id: number; code: string; name: string }[]; totalLeads?: number; error?: string } | null>(null);

  /** Proyecto de Sperant (id) → proyecto del CRM (id), 'crear' o null (no importar). */
  const [proyectos, setProyectos] = useState<Record<string, string | null> | null>(null);
  const [etapas, setEtapas] = useState<Record<string, string | null>>({});
  const [asesores, setAsesores] = useState<Record<string, string | null>>({});
  const [importarUnidades, setImportarUnidades] = useState(true);
  const [importarProformas, setImportarProformas] = useState(true);
  const [informe, setInforme] = useState<Informe | null>(null);
  /** Códigos de unidad cuyos cambios la persona aprobó tras ver la comparativa. */
  const [aprobadas, setAprobadas] = useState<Set<string>>(new Set());

  // La sugerencia del servidor rellena el mapa una vez; después manda lo que toque la persona.
  useEffect(() => {
    if (!d?.sugerencia) return;
    setEtapas((prev) => (Object.keys(prev).length ? prev : d.sugerencia!.etapas));
    setAsesores((prev) => (Object.keys(prev).length ? prev : d.sugerencia!.asesores));
    setProyectos((prev) => prev ?? d.sugerencia!.proyectos);
  }, [d]);

  const guardar = useMutation({
    mutationFn: () => api.put('/sperant/config', { ...(token.trim() ? { token: token.trim() } : {}) }),
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
  const cuerpo = (simulacion: boolean) => ({ simulacion, proyectos: proyectos ?? {}, etapas, asesores, importarUnidades, importarProformas, unidadesAprobadas: [...aprobadas] });
  const simular = useMutation({
    mutationFn: () => api.post<Informe>('/sperant/importar', cuerpo(true)),
    // Cada simulación nueva vuelve a pedir aprobación: la comparativa puede haber cambiado.
    onSuccess: (i) => { setInforme(i); setAprobadas(new Set()); },
  });
  const importarReal = useMutation({
    mutationFn: () => api.post('/sperant/importar', cuerpo(false)),
    onSuccess: () => { setInforme(null); setAprobadas(new Set()); qc.invalidateQueries({ queryKey: ['sperant-estado'] }); },
  });
  const pendientes = informe?.unidades.diferencias.filter((x) => !aprobadas.has(x.clave)).length ?? 0;
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
  const listoParaImportar = d.estado.hayDatos && !enCurso && !r?.exportViejo && Object.values(proyectos ?? {}).some(Boolean);

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
          <button className="btn" disabled={guardar.isPending || (!token.trim() && !d.config.tokenHint)}>Guardar</button>
          <button type="button" className="btn btn-sec" disabled={!d.config.tokenHint || probar.isPending} onClick={() => probar.mutate()}>Probar</button>
        </form>
        {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
        {prueba && (prueba.ok ? (
          <p className="ok">
            Conecta. {prueba.totalLeads?.toLocaleString('es-PE')} leads. Proyectos: {prueba.proyectos?.map((p) => `${p.name} (id ${p.id}, ${p.code})`).join(' · ')}.

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
          </div>
        )}
        {r && (
          <div style={{ marginTop: 14 }}>
            <strong style={{ fontSize: 13 }}>Proyectos en la cuenta de Sperant ({r.proyectos.length})</strong>
            {r.exportViejo && (
              <p className="error">Este export es de antes de traer todos los proyectos: pulsa «Exportar de nuevo» para ver el inventario de cada uno.</p>
            )}
            {r.sinProyecto > 0 && (
              <p className="error">{r.sinProyecto} clientes llegaron sin proyecto (falló la petición a Sperant): «Exportar de nuevo» los completa.</p>
            )}
            <table className="tabla-compacta" style={{ marginTop: 6 }}>
              <thead>
                <tr><th style={{ textAlign: 'left' }}>Proyecto</th><th style={{ textAlign: 'right' }}>Leads</th><th style={{ textAlign: 'right' }}>Unidades</th><th style={{ textAlign: 'left' }}>Tipologías</th><th style={{ textAlign: 'right' }}>Proformas</th></tr>
              </thead>
              <tbody>
                {r.proyectos.map((p) => (
                  <tr key={p.id}>
                    <td><strong>{p.nombre}</strong> <span className="meta">id {p.id}{p.codigo ? ` · ${p.codigo}` : ''}{p.direccion ? ` · ${p.direccion}` : ''}</span></td>
                    <td style={{ textAlign: 'right' }}>{p.leads.toLocaleString('es-PE')}</td>
                    <td style={{ textAlign: 'right' }}>{p.unidades ?? '—'}{p.porEstado.length ? <div className="meta">{p.porEstado.map((x) => `${x.valor} ${x.n}`).join(' · ')}</div> : null}</td>
                    <td className="meta">{p.tipologias?.join(', ') ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}>{p.proformas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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

          <strong style={{ fontSize: 13, display: 'block', marginTop: 10 }}>Proyectos</strong>
          <p className="meta">Cada proyecto de Sperant va a un proyecto del CRM, a uno nuevo con su nombre, o no se importa (ni sus leads ni su inventario). Dos proyectos de Sperant no pueden ir al mismo del CRM.</p>
          {r.proyectos.map((p) => {
            const valor = proyectos?.[String(p.id)] ?? '';
            const ocupado = (id: string) => Object.entries(proyectos ?? {}).some(([k, v]) => v === id && k !== String(p.id));
            return (
              <div key={p.id} className="fila-mapa">
                <span>{p.nombre} <span className="meta">({p.leads} leads · {p.unidades ?? '?'} unidades)</span></span>
                <select value={valor} onChange={(ev) => setProyectos({ ...(proyectos ?? {}), [String(p.id)]: ev.target.value || null })}>
                  <option value="">No importar</option>
                  <option value="crear">Crear proyecto «{p.nombre}»</option>
                  {d.proyectosCrm.map((c) => <option key={c.id} value={c.id} disabled={ocupado(c.id)}>{c.name}{ocupado(c.id) ? ' (ya elegido)' : ''}</option>)}
                </select>
              </div>
            );
          })}

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
              onClick={() => {
                const partes = [`crear ${informe?.leads.nuevos} leads`, `fusionar ${informe?.leads.fusionados}`, `crear ${informe?.unidades.creadas} unidades`, `actualizar ${aprobadas.size} unidades aprobadas`];
                const aviso = pendientes ? `\n\n${pendientes} unidad(es) con cambios NO aprobadas se dejan como están en el CRM.` : '';
                if (confirm(`Se va a: ${partes.join(', ')}.${aviso}\n\n¿Continuar?`)) importarReal.mutate();
              }}
            >
              Importar de verdad
            </button>
          </div>
          {simular.isError && <p className="error">{(simular.error as Error).message}</p>}
          {importarReal.isError && <p className="error">{(importarReal.error as Error).message}</p>}

          {enCurso && d.estado.tarea === 'importar' && (
            <p className="meta" style={{ marginTop: 8 }}>Importando… {d.estado.hechos ?? 0}{d.estado.total ? ` / ${d.estado.total}` : ''}</p>
          )}

          {informe && informe.unidades.diferencias.length > 0 && (
            <Comparativa diferencias={informe.unidades.diferencias} aprobadas={aprobadas} onCambio={setAprobadas} />
          )}
          {(informe ?? d.estado.importe) && <ResultadoImporte informe={(informe ?? d.estado.importe)!} />}
        </div>
      )}
      {d.estado.hayDatos && <CompletarDatos ocupado={enCurso} />}
      <AsesoresSperant ocupado={enCurso} />
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
          <tr><td>De proyectos que no se importan</td><td>{i.leads.deProyectoNoImportado ?? 0}</td></tr>
          {(i.leads.sinProyecto ?? 0) > 0 && <tr className="error"><td>Sin proyecto en el export (exportar de nuevo)</td><td>{i.leads.sinProyecto}</td></tr>}
          {(i.proyectos ?? []).map((p) => (
            <tr key={p.sperant}><td>{p.sperant} → {p.crm ? `${p.crm}${p.creado ? ' (nuevo)' : ''}` : 'no se importa'}</td><td>{p.crm ? `${p.leads} leads nuevos · ${p.unidades} unidades` : '—'}</td></tr>
          ))}
          <tr><td>Sin etapa en el mapa (quedan sin etapa)</td><td>{i.leads.sinEtapa}</td></tr>
          <tr><td>Sin asesor</td><td>{i.leads.sinAsesor}</td></tr>
          <tr><td>Contactos nuevos / ya existentes</td><td>{i.contactos.nuevos} / {i.contactos.existentes}</td></tr>
          <tr><td>Unidades nuevas</td><td>{i.unidades.creadas}</td></tr>
          <tr><td>Unidades sin cambios</td><td>{i.unidades.sinCambios}</td></tr>
          <tr><td>Unidades con cambios {i.simulacion ? 'aprobados' : 'aplicados'}</td><td>{i.unidades.actualizadas}</td></tr>
          <tr><td>Unidades con cambios {i.simulacion ? 'pendientes de aprobar' : 'no aprobados (se dejaron como estaban)'}</td><td>{i.unidades.pendientes}</td></tr>
          <tr><td>Tipologías nuevas</td><td>{i.unidades.tipologiasCreadas}</td></tr>
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

const VALOR = (v: string | number | null) => (v === null || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('es-PE') : String(v).replace('_', ' '));

/**
 * Comparativa de unidades: lo que dice el CRM frente a lo que dice Sperant, solo donde
 * difieren. Nada se aprueba por defecto: la importación real solo escribe lo marcado.
 */
function Comparativa({ diferencias, aprobadas, onCambio }: { diferencias: Diferencia[]; aprobadas: Set<string>; onCambio: (s: Set<string>) => void }) {
  const todas = diferencias.every((x) => aprobadas.has(x.clave));
  const alternar = (clave: string) => {
    const n = new Set(aprobadas);
    if (n.has(clave)) n.delete(clave); else n.add(clave);
    onCambio(n);
  };
  return (
    <div className="comparativa">
      <div className="comparativa-cabecera">
        <strong style={{ fontSize: 13 }}>Unidades que difieren entre el CRM y Sperant ({diferencias.length})</strong>
        <button type="button" className="enlace-btn" onClick={() => onCambio(todas ? new Set() : new Set(diferencias.map((x) => x.clave)))}>
          {todas ? 'Quitar todas' : 'Aprobar todas'}
        </button>
      </div>
      <p className="meta">Marca las unidades cuyo valor de Sperant quieres traer. Las no marcadas se quedan como están en el CRM. Los cambios de precio quedan en el registro de auditoría.</p>
      <table className="tabla-comparativa">
        <thead>
          <tr><th></th><th>Unidad</th><th>Campo</th><th>CRM (ahora)</th><th>Sperant</th></tr>
        </thead>
        <tbody>
          {diferencias.map((u) => {
            const campos = Object.entries(u.cambios);
            return campos.map(([campo, v], i) => (
              <tr key={`${u.clave}-${campo}`} className={aprobadas.has(u.clave) ? 'aprobada' : ''}>
                {i === 0 && (
                  <td rowSpan={campos.length}><input type="checkbox" checked={aprobadas.has(u.clave)} onChange={() => alternar(u.clave)} aria-label={`Aprobar ${u.code}`} /></td>
                )}
                {i === 0 && <td rowSpan={campos.length}><strong>{u.code}</strong><div className="meta">{u.proyecto}</div></td>}
                <td>{campo}</td>
                <td>{VALOR(v.crm)}</td>
                <td className="sperant">{VALOR(v.sperant)}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

interface InformeCompletar {
  simulacion: boolean;
  leadsRevisados: number;
  leadsCompletados: number;
  fusionesCompletadas: number;
  documentosFalsosLimpiados: number;
  proformasCompletadas: number;
  sinLeadEnCrm: number;
  diagnostico: {
    clientesEnExport: number;
    sinDetalleEnExport: number;
    documentosAutoEnExport: number;
    documentoAutoContactoSinDocumento: number;
    documentoAutoContactoConOtro: number;
    proformasEnExport: number;
    notasProformaExistentes: number;
    notasProformaACrear: number;
  };
  inventarioDesconocido: boolean;
  inventarios: {
    faltaExportarDetalle: boolean;
    proyecto: string | null;
    unidadesCompletadas: number;
    unidadesSinParejaEnCrm: string[];
    tipologiasCompletadas: number;
    imagenesCopiadas: number;
    imagenesConError: number;
    direccionCompletada: boolean;
    inventarioDe: string | null;
    unidadesDeOtroProyecto: string[];
    tipologiasDeOtroProyecto: string[];
    tipologiasAjenasEnUso: string[];
    tipologiasEnlazadas: string[];
  }[];
  reparados: { leads: number; conEtapa: number; perdidos: number; sinEtapaEnCrm: string[]; fechasCorregidas: number };
}

/**
 * Para leads importados antes de que se guardara la ficha completa de Sperant: agrega lo
 * que faltaba (género, estado civil, ubicación, pareja, campos extra, cotitulares…) sin
 * tocar lo que el equipo ya editó en el CRM.
 */
function CompletarDatos({ ocupado }: { ocupado: boolean }) {
  const [informe, setInforme] = useState<InformeCompletar | null>(null);
  const correr = useMutation({
    mutationFn: (simulacion: boolean) => api.post<InformeCompletar>('/sperant/completar', { simulacion }),
    onSuccess: setInforme,
  });
  return (
    <div className="card">
      <strong>Completar datos de leads ya importados</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Guarda en cada lead importado la ficha completa de Sperant: género, estado civil, ubicación, pareja o
        cónyuge, teléfono principal, campos extra, interacciones y los cotitulares y precios de sus proformas.
        Se ve en la ficha del lead, en «Datos de Sperant». No cambia etapa, asesor ni datos que hayan editado en el
        CRM. Además quita los documentos falsos «auto-…» que Sperant pone cuando no hay DNI. Se puede correr
        varias veces.
      </p>
      <div className="acciones">
        <button type="button" className="btn btn-sec" disabled={ocupado || correr.isPending} onClick={() => correr.mutate(true)}>
          {correr.isPending && correr.variables ? 'Revisando…' : 'Simular'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={ocupado || correr.isPending || !informe?.simulacion}
          onClick={() => correr.mutate(false)}
        >
          {correr.isPending && !correr.variables ? 'Completando…' : 'Completar'}
        </button>
      </div>
      {correr.isError && <p className="error">{(correr.error as Error).message}</p>}
      {informe && (
        <table className="tabla-compacta" style={{ marginTop: 8 }}>
          <tbody>
            <tr><td colSpan={2}><strong>{informe.simulacion ? 'Simulación (no se escribió nada)' : 'Hecho'}</strong></td></tr>
            <tr><td>Leads de Sperant en el CRM</td><td>{informe.leadsRevisados}</td></tr>
            <tr><td>Leads {informe.simulacion ? 'a completar' : 'completados'} con la ficha</td><td>{informe.leadsCompletados}</td></tr>
            <tr><td>Registros duplicados de Sperant {informe.simulacion ? 'a guardar' : 'guardados'} en su lead</td><td>{informe.fusionesCompletadas}</td></tr>
            <tr><td>Documentos «auto-…» {informe.simulacion ? 'a quitar' : 'quitados'}</td><td>{informe.documentosFalsosLimpiados}</td></tr>
            <tr><td>Notas de proforma {informe.simulacion ? 'a completar' : 'completadas'}</td><td>{informe.proformasCompletadas}</td></tr>
            <tr><td>Clientes del export sin lead en el CRM (omitidos o borrados)</td><td>{informe.sinLeadEnCrm}</td></tr>
            <tr><td>Notas de proforma que faltaban y se {informe.simulacion ? 'crearían' : 'crearon'}</td><td>{informe.diagnostico.notasProformaACrear}</td></tr>
            <tr><td>Leads importados sin etapa ni asesor que se {informe.simulacion ? 'reparan' : 'repararon'} con el export actual</td><td>{informe.reparados.leads}</td></tr>
            <tr><td>Leads sin etapa (o en «(vacío)») que reciben su etapa de Sperant</td><td>{informe.reparados.conEtapa}</td></tr>
            <tr><td>Leads con fecha de alta corregida (tenían la del día de la importación)</td><td>{informe.reparados.fechasCorregidas}</td></tr>
            {(informe.reparados.conEtapa > 0 || informe.reparados.sinEtapaEnCrm.length > 0) && (
              <>
                <tr><td>… de ellos, pasan a perdidos (desestimados en Sperant)</td><td>{informe.reparados.perdidos}</td></tr>
                {informe.reparados.sinEtapaEnCrm.length > 0 && (
                  <tr className="error"><td>Etapas de Sperant sin etapa con ese nombre en el CRM (quedan sin etapa)</td><td>{informe.reparados.sinEtapaEnCrm.join(', ')}</td></tr>
                )}
              </>
            )}
            {informe.inventarioDesconocido && (
              <tr className="error"><td colSpan={2}>El export no dice de qué proyecto es el inventario: pulsa «Exportar de nuevo» arriba y vuelve a simular.</td></tr>
            )}
            {informe.inventarios.map((inv) => (
              <React.Fragment key={inv.inventarioDe ?? inv.proyecto ?? ''}>
            <tr><td colSpan={2}><strong>Inventario{inv.proyecto ? ` del CRM: ${inv.proyecto}` : ''}{inv.inventarioDe ? ` · de Sperant: ${inv.inventarioDe}` : ''}</strong></td></tr>
            {inv.inventarioDe && inv.proyecto && inv.inventarioDe.toLowerCase() !== inv.proyecto.toLowerCase() && (
              <tr className="error"><td colSpan={2}>El inventario exportado es de «{inv.inventarioDe}», no de «{inv.proyecto}». Revisa el id del proyecto de Sperant en el paso 1 y exporta de nuevo.</td></tr>
            )}
            {inv.unidadesDeOtroProyecto.length > 0 && (
              <tr className="error"><td>Unidades de otro proyecto de Sperant que se {informe.simulacion ? 'quitarán' : 'quitaron'}</td><td>{inv.unidadesDeOtroProyecto.join(', ')}</td></tr>
            )}
            {inv.tipologiasDeOtroProyecto.length > 0 && (
              <tr className="error"><td>Tipologías de otro proyecto de Sperant que se {informe.simulacion ? 'quitarán' : 'quitaron'}</td><td>{inv.tipologiasDeOtroProyecto.join(', ')}</td></tr>
            )}
            {inv.tipologiasAjenasEnUso.length > 0 && (
              <tr><td>Tipologías de otro proyecto que todavía tienen unidades o interesados (primero importa y aprueba los cambios de unidades)</td><td>{inv.tipologiasAjenasEnUso.join(', ')}</td></tr>
            )}
            {inv.faltaExportarDetalle ? (
              <tr className="error"><td colSpan={2}>El export es anterior al detalle de unidades: pulsa «Exportar de nuevo» arriba y vuelve a simular.</td></tr>
            ) : (
              <>
                <tr><td>Unidades {informe.simulacion ? 'a completar' : 'completadas'} (piso, dormitorios, baños, vista, áreas)</td><td>{inv.unidadesCompletadas}</td></tr>
                {inv.tipologiasEnlazadas.length > 0 && <tr><td>Unidades a las que se les enlaza su tipología</td><td>{inv.tipologiasEnlazadas.join(', ')}</td></tr>}
                <tr><td>Unidades de Sperant que no están en el CRM</td><td>{inv.unidadesSinParejaEnCrm.join(', ') || '0'}</td></tr>
                <tr><td>Tipologías con imágenes alojadas en Sperant {informe.simulacion ? '(se copiarán al CRM)' : ''}</td><td>{inv.tipologiasCompletadas}</td></tr>
                {!informe.simulacion && <tr><td>Imágenes copiadas / con error</td><td>{inv.imagenesCopiadas} / {inv.imagenesConError}</td></tr>}
                <tr><td>Dirección del proyecto</td><td>{inv.direccionCompletada ? (informe.simulacion ? 'se completa' : 'completada') : 'ya estaba'}</td></tr>
              </>
            )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
      {informe && (
        <details style={{ marginTop: 8 }} open={informe.diagnostico.sinDetalleEnExport > 0}>
          <summary className="meta">Diagnóstico del export</summary>
          <table className="tabla-compacta" style={{ marginTop: 6 }}>
            <tbody>
              <tr><td>Clientes en el export</td><td>{informe.diagnostico.clientesEnExport}</td></tr>
              <tr className={informe.diagnostico.sinDetalleEnExport > 0 ? 'error' : ''}>
                <td>Clientes sin ficha de detalle (la exportación no la trajo; hay que exportar de nuevo)</td>
                <td>{informe.diagnostico.sinDetalleEnExport}</td>
              </tr>
              <tr><td>Documentos «auto-…» en el export</td><td>{informe.diagnostico.documentosAutoEnExport}</td></tr>
              <tr><td>… cuyo contacto ya no tiene documento (ya quitado, o el contacto existía en el CRM antes de importar)</td><td>{informe.diagnostico.documentoAutoContactoSinDocumento}</td></tr>
              <tr><td>… cuyo contacto tiene otro documento (existía con DNI real o se editó; no se toca)</td><td>{informe.diagnostico.documentoAutoContactoConOtro}</td></tr>
              <tr><td>Proformas en el export</td><td>{informe.diagnostico.proformasEnExport}</td></tr>
              <tr><td>Notas de proforma que ya había en el CRM</td><td>{informe.diagnostico.notasProformaExistentes}</td></tr>
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

interface AsesorSp {
  username: string;
  leads: number;
  abiertos: number;
  duenosActuales: { nombre: string; leads: number }[];
  sugerido: { nombre: string; email: string } | null;
}
type Eleccion = { modo: 'nada' } | { modo: 'existente'; userId: string } | { modo: 'crear'; name: string; email: string; role: 'asesor' | 'gerente' };

/**
 * Reparte los leads importados según quién los llevaba en Sperant. Sirve para deshacer una
 * asignación provisional (todo a una persona) y para dar de alta a los asesores de una vez.
 */
function AsesoresSperant({ ocupado }: { ocupado: boolean }) {
  const qc = useQueryClient();
  const asesores = useQuery({ queryKey: ['sperant-asesores'], queryFn: () => api.get<AsesorSp[]>('/sperant/asesores') });
  const usuarios = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ id: string; name: string; email: string; active: boolean }[]>('/users') });
  const [eleccion, setEleccion] = useState<Record<string, Eleccion>>({});
  const [resultado, setResultado] = useState<{ username: string; usuario: string; creado: boolean; leads: number }[] | null>(null);
  const reasignar = useMutation({
    mutationFn: () =>
      api.post<{ resultado: NonNullable<typeof resultado> }>('/sperant/reasignar', {
        asignaciones: Object.entries(eleccion)
          .filter(([, e]) => e.modo !== 'nada')
          .map(([username, e]) =>
            e.modo === 'existente' ? { username, userId: e.userId } : { username, crear: { name: (e as { name: string }).name, email: (e as { email: string }).email, role: (e as { role: 'asesor' | 'gerente' }).role } },
          ),
      }),
    onSuccess: (r) => {
      setResultado(r.resultado);
      setEleccion({});
      qc.invalidateQueries({ queryKey: ['sperant-asesores'] });
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });
  if (!asesores.data?.length) return null;
  const elegidas = Object.values(eleccion).filter((e) => e.modo !== 'nada');
  const incompleta = elegidas.some((e) => e.modo === 'crear' && (!e.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.email.trim())));
  const total = asesores.data.filter((a) => (eleccion[a.username]?.modo ?? 'nada') !== 'nada').reduce((n, a) => n + a.leads, 0);

  return (
    <div className="card">
      <strong>Asesores: de Sperant al CRM</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Reparte los leads importados según quién los llevaba en Sperant. Elige un usuario existente o crea uno nuevo:
        el usuario nuevo entra con un enlace a su correo (sin contraseña). Cambia el asesor actual de esos leads, sin
        mandar avisos, y lo deja en el historial de cada uno. No toca los leads que entraron por el CRM.
      </p>
      <table className="tabla-compacta" style={{ marginTop: 8 }}>
        <thead>
          <tr><th style={{ textAlign: 'left' }}>En Sperant</th><th style={{ textAlign: 'left' }}>Leads</th><th style={{ textAlign: 'left' }}>Hoy los tiene</th><th style={{ textAlign: 'left' }}>Pasarlos a</th></tr>
        </thead>
        <tbody>
          {asesores.data.map((a) => {
            const e = eleccion[a.username] ?? { modo: 'nada' };
            const poner = (x: Eleccion) => setEleccion({ ...eleccion, [a.username]: x });
            return (
              <tr key={a.username}>
                <td style={{ verticalAlign: 'top' }}><strong>{a.username}</strong>{a.sugerido?.nombre && <div className="meta">{a.sugerido.nombre}</div>}</td>
                <td style={{ verticalAlign: 'top' }}>{a.leads}<div className="meta">{a.abiertos} abiertos</div></td>
                <td style={{ verticalAlign: 'top' }} className="meta">{a.duenosActuales.map((d) => `${d.nombre}: ${d.leads}`).join(' · ')}</td>
                <td style={{ verticalAlign: 'top', minWidth: 240 }}>
                  <select
                    value={e.modo === 'existente' ? e.userId : e.modo}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      if (v === 'nada') poner({ modo: 'nada' });
                      else if (v === 'crear') poner({ modo: 'crear', name: a.sugerido?.nombre ?? '', email: a.sugerido?.email ?? '', role: 'asesor' });
                      else poner({ modo: 'existente', userId: v });
                    }}
                  >
                    <option value="nada">No cambiar</option>
                    <option value="crear">Crear usuario nuevo…</option>
                    {usuarios.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </select>
                  {e.modo === 'crear' && (
                    <div style={{ marginTop: 6, display: 'grid', gap: 4 }}>
                      <input placeholder="Nombre" value={e.name} onChange={(ev) => poner({ ...e, name: ev.target.value })} />
                      <input placeholder="Correo (con él entra)" type="email" value={e.email} onChange={(ev) => poner({ ...e, email: ev.target.value })} />
                      <select value={e.role} onChange={(ev) => poner({ ...e, role: ev.target.value as 'asesor' | 'gerente' })}>
                        <option value="asesor">Asesor (recibe leads nuevos en el reparto)</option>
                        <option value="gerente">Gerente (ve todo, no entra al reparto)</option>
                      </select>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {reasignar.isError && <p className="error">{(reasignar.error as Error).message}</p>}
      <div className="acciones">
        <button
          type="button"
          className="btn"
          disabled={ocupado || reasignar.isPending || elegidas.length === 0 || incompleta}
          onClick={() => {
            if (confirm(`Se van a reasignar ${total} leads${elegidas.some((e) => e.modo === 'crear') ? ' y crear los usuarios nuevos' : ''}. ¿Continuar?`)) reasignar.mutate();
          }}
        >
          {reasignar.isPending ? 'Reasignando…' : 'Crear usuarios y reasignar'}
        </button>
      </div>
      {resultado && (
        <ul className="meta" style={{ marginTop: 8 }}>
          {resultado.map((r) => (
            <li key={r.username}>
              {r.username} → {r.usuario}{r.creado ? ' (usuario creado)' : ''}: {r.leads} leads reasignados
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
