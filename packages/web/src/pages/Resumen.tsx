import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';
import Kpi from '../components/Kpi.js';
import MatrizPuntos from '../components/MatrizPuntos.js';
import TablaLeads, { type LeadFila } from '../components/TablaLeads.js';
import NuevoLead from './NuevoLead.js';
import {
  PERIODOS,
  duracion,
  porcentaje,
  variacion,
  type Resumen as DatosResumen,
} from '../lib/reportes.js';

type Vista = 'actividad' | 'nuevos';

/** Pantalla de inicio: cómo va el embudo y qué hay que atender ahora. */
export default function Resumen() {
  const [dias, setDias] = useState(30);
  const [vista, setVista] = useState<Vista>('actividad');
  const [creando, setCreando] = useState(false);

  const datos = useQuery({
    queryKey: ['reportes', dias],
    queryFn: () => api.get<DatosResumen>(`/reportes/resumen?dias=${dias}`),
    refetchInterval: 60_000,
    placeholderData: (previo) => previo,
  });
  const leads = useQuery({
    queryKey: ['leads-resumen', vista],
    queryFn: () =>
      api.get<{ total: number; leads: LeadFila[] }>(
        `/leads?perPage=8&orden=${vista === 'nuevos' ? 'creacion' : 'actividad'}`
      ),
    refetchInterval: 20_000,
    placeholderData: (previo) => previo,
  });

  const r = datos.data;
  const tiempo = duracion(r?.actual.medianaPrimerContactoMin ?? null);

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
        <button type="button" className="btn" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={15} />Nuevo lead
        </button>
      </div>

      {creando && <NuevoLead onCerrar={() => setCreando(false)} />}

      <div className="kpis">
        <Kpi
          titulo="Leads nuevos"
          icono="leads"
          tono="solido"
          valor={r ? String(r.actual.leads) : '—'}
          delta={r ? variacion(r.actual.leads, r.previo.leads) : undefined}
        />
        <Kpi
          titulo="Tasa de contacto"
          icono="check"
          valor={r ? porcentaje(r.actual.tasaContacto) : '—'}
          delta={r ? variacion(r.actual.tasaContacto, r.previo.tasaContacto) : undefined}
        />
        <Kpi
          titulo="Primer contacto"
          icono="reloj"
          tono="navy"
          valor={tiempo.valor}
          unidad={tiempo.unidad}
          delta={
            r
              ? variacion(r.actual.medianaPrimerContactoMin, r.previo.medianaPrimerContactoMin, true)
              : undefined
          }
        />
        <Kpi
          titulo="Sin contactar"
          icono="alerta"
          tono="ambar"
          valor={r ? String(r.sinContactar) : '—'}
          nota="esperando hoy la primera llamada"
        />
      </div>

      <section className="panel">
        <div className="panel-cab">
          <h2 className="titulo-panel">
            Leads por día
            <span title="Cada columna es un día. En gris, el mismo día del período anterior.">
              <Icono nombre="info" tam={14} />
            </span>
          </h2>
          <Link to="/reportes" className="btn btn-sec" style={{ padding: '6px 11px', fontSize: 12.5 }}>
            Ver reportes
          </Link>
        </div>
        <div className="panel-cuerpo">
          {r ? (
            <MatrizPuntos
              etiqueta="Leads"
              serie={r.serie.map((p) => ({ fecha: p.fecha, actual: p.leads, previo: p.leadsPrev }))}
            />
          ) : (
            <div className="vacio">Cargando…</div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-cab" style={{ paddingTop: 6 }}>
          <div className="pestanas" style={{ marginBottom: 0, borderBottom: 0 }}>
            <button type="button" className={vista === 'actividad' ? 'activa' : ''} onClick={() => setVista('actividad')}>
              Actividad reciente
            </button>
            <button type="button" className={vista === 'nuevos' ? 'activa' : ''} onClick={() => setVista('nuevos')}>
              Recién llegados
            </button>
          </div>
          <Link to="/leads" className="meta" style={{ fontWeight: 600, color: 'var(--azul)' }}>
            Ver todos{leads.data ? ` (${leads.data.total})` : ''}
          </Link>
        </div>
        <div style={{ borderTop: '1px solid var(--borde)' }}>
          {leads.data?.leads.length === 0 && <div className="vacio">Todavía no hay leads.</div>}
          {leads.data && leads.data.leads.length > 0 && (
            <div className="panel-lista">
              <TablaLeads leads={leads.data.leads} compacta />
            </div>
          )}
        </div>
      </section>
    </>
  );
}
