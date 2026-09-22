import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';
import { KpiContenido } from '../components/Kpi.js';
import MatrizPuntos from '../components/MatrizPuntos.js';
import {
  FUENTES,
  PERIODOS,
  duracion,
  porcentaje,
  variacion,
  type Resumen,
} from '../lib/reportes.js';

type Metrica = 'leads' | 'contactados' | 'ganados';

const METRICAS: Record<Metrica, string> = {
  leads: 'Leads',
  contactados: 'Contactados',
  ganados: 'Ganados',
};

/** Barras horizontales de un solo tono: la etiqueta dice qué es, la longitud cuánto. */
function Barras({
  filas,
  suave = false,
}: {
  filas: { clave: string; etiqueta: React.ReactNode; n: number; nota?: React.ReactNode }[];
  suave?: boolean;
}) {
  const max = Math.max(1, ...filas.map((f) => f.n));
  if (filas.length === 0) return <div className="vacio" style={{ padding: 20 }}>Sin datos en el período.</div>;
  return (
    <div className="barras">
      {filas.map((f) => (
        <div key={f.clave} className="barra-fila">
          <span className="etq">{f.etiqueta}</span>
          <span className={`barra-pista${suave ? ' suave' : ''}`}>
            <i style={{ width: `${(f.n / max) * 100}%` }} />
          </span>
          <span className="val">
            {f.n}
            {f.nota}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Reportes() {
  const [dias, setDias] = useState(30);
  const [proyecto, setProyecto] = useState('');
  const [metrica, setMetrica] = useState<Metrica>('leads');

  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });
  const datos = useQuery({
    queryKey: ['reportes', dias, proyecto],
    queryFn: () =>
      api.get<Resumen>(
        `/reportes/resumen?${new URLSearchParams({ dias: String(dias), ...(proyecto ? { proyecto } : {}) })}`
      ),
    placeholderData: (previo) => previo,
  });

  const r = datos.data;
  const tiempo = duracion(r?.actual.medianaPrimerContactoMin ?? null);
  const serie = (r?.serie ?? []).map((p) => ({
    fecha: p.fecha,
    actual: p[metrica],
    previo: p[`${metrica}Prev` as const],
  }));

  const totalEtapas = r?.porEtapa.reduce((s, e) => s + e.n, 0) ?? 0;
  const ganados = r?.actual.ganados ?? 0;
  const tasaCierre = r && r.actual.leads ? ganados / r.actual.leads : null;
  const tasaCierrePrev = r && r.previo.leads ? r.previo.ganados / r.previo.leads : null;

  return (
    <>
      <div className="herramientas">
        <label className="control" style={{ margin: 0 }}>
          <Icono nombre="calendario" tam={15} />
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
            {PERIODOS.map((p) => <option key={p.dias} value={p.dias}>{p.texto}</option>)}
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        <span className="control-txt">comparado con los {dias} días anteriores</span>
        <span className="empuja" />
        <label className="control" style={{ margin: 0 }}>
          <Icono nombre="carpeta" tam={15} />
          <select value={proyecto} onChange={(e) => setProyecto(e.target.value)} aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
      </div>

      <section className="panel">
        <div className="panel-cab">
          <h2 className="titulo-panel">
            Tendencia de {METRICAS[metrica].toLowerCase()}
            <span title="Cada columna es un día. En gris, el mismo día del período anterior.">
              <Icono nombre="info" tam={14} />
            </span>
          </h2>
          <label className="control" style={{ margin: 0 }}>
            <select value={metrica} onChange={(e) => setMetrica(e.target.value as Metrica)} aria-label="Métrica">
              {Object.entries(METRICAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <Icono nombre="abajo" tam={14} />
          </label>
        </div>
        <div className="panel-cuerpo">
          {r ? <MatrizPuntos etiqueta={METRICAS[metrica]} serie={serie} /> : <div className="vacio">Cargando…</div>}
        </div>

        {/* Los indicadores son también las pestañas del gráfico. */}
        <div className="kpi-tabs">
          <button type="button" className={`kpi-tab${metrica === 'leads' ? ' activa' : ''}`} onClick={() => setMetrica('leads')}>
            <KpiContenido
              titulo="Leads nuevos"
              icono="leads"
              tono="solido"
              valor={r ? String(r.actual.leads) : '—'}
              delta={r ? variacion(r.actual.leads, r.previo.leads) : undefined}
            />
          </button>
          <button type="button" className={`kpi-tab${metrica === 'contactados' ? ' activa' : ''}`} onClick={() => setMetrica('contactados')}>
            <KpiContenido
              titulo="Contactados"
              icono="check"
              valor={r ? String(r.actual.contactados) : '—'}
              delta={r ? variacion(r.actual.contactados, r.previo.contactados) : undefined}
            />
          </button>
          <button type="button" className={`kpi-tab${metrica === 'ganados' ? ' activa' : ''}`} onClick={() => setMetrica('ganados')}>
            <KpiContenido
              titulo="Ganados"
              icono="subir"
              tono="navy"
              valor={r ? String(r.actual.ganados) : '—'}
              delta={r ? variacion(r.actual.ganados, r.previo.ganados) : undefined}
            />
          </button>
          <div className="kpi-tab" style={{ cursor: 'default' }}>
            <KpiContenido
              titulo="Primer contacto"
              icono="reloj"
              tono="ambar"
              valor={tiempo.valor}
              unidad={tiempo.unidad}
              delta={
                r
                  ? variacion(r.actual.medianaPrimerContactoMin, r.previo.medianaPrimerContactoMin, true)
                  : undefined
              }
            />
          </div>
        </div>
      </section>

      <div className="rejilla-paneles">
        <section className="panel">
          <div className="panel-cab">
            <h2 className="titulo-panel">Embudo por etapa</h2>
          </div>
          <div className="panel-cuerpo">
            <div className="cifra">
              {porcentaje(tasaCierre)}
              {r && (() => {
                const v = variacion(tasaCierre, tasaCierrePrev);
                return (
                  <span className="kpi-delta" style={{ display: 'inline-flex', marginLeft: 8, verticalAlign: 'middle' }}>
                    <b className={v.tono}>{v.texto}</b>
                  </span>
                );
              })()}
            </div>
            <div className="meta">de los leads del período ya están ganados</div>

            {/* Distribución por etapa: el color de cada etapa, con su nombre en la lista de abajo. */}
            {totalEtapas > 0 && (
              <div className="segmentos" aria-hidden="true">
                {r!.porEtapa.filter((e) => e.n > 0).map((e) => (
                  <i key={e.id} style={{ flex: e.n, background: e.color ?? 'var(--tenue)' }} title={`${e.name}: ${e.n}`} />
                ))}
              </div>
            )}
            <div style={{ marginTop: totalEtapas > 0 ? 6 : 16 }}>
              <Barras
                filas={(r?.porEtapa ?? []).map((e) => ({
                  clave: e.id,
                  etiqueta: (
                    <>
                      <span className="estado"><i style={{ background: e.color ?? 'var(--tenue)' }} /></span>
                      {e.name}
                    </>
                  ),
                  n: e.n,
                }))}
              />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-cab">
            <h2 className="titulo-panel">De dónde llegan</h2>
          </div>
          <div className="panel-cuerpo">
            {r && r.porFuente.length > 0 && (
              <>
                <div className="cifra">{FUENTES[r.porFuente[0]!.source] ?? r.porFuente[0]!.source}</div>
                <div className="meta" style={{ marginBottom: 16 }}>
                  la fuente principal: {r.actual.leads ? Math.round((r.porFuente[0]!.n / r.actual.leads) * 100) : 0}% de los leads
                </div>
              </>
            )}
            <Barras
              filas={(r?.porFuente ?? []).map((f) => {
                const v = variacion(f.n, f.nPrev);
                return {
                  clave: f.source,
                  etiqueta: FUENTES[f.source] ?? f.source,
                  n: f.n,
                  nota: v.tono ? (
                    <span className={`kpi-delta`} style={{ display: 'inline-flex', marginLeft: 6, marginTop: 0 }}>
                      <b className={v.tono}>{v.texto}</b>
                    </span>
                  ) : undefined,
                };
              })}
            />
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-cab">
          <h2 className="titulo-panel">Leads por proyecto</h2>
        </div>
        <div className="panel-cuerpo">
          <Barras
            suave
            filas={(r?.porProyecto ?? []).map((p) => ({ clave: p.id ?? 'sin', etiqueta: p.name, n: p.n }))}
          />
        </div>
      </section>
    </>
  );
}
