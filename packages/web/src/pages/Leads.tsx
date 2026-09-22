import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import NuevoLead from './NuevoLead.js';
import Icono from '../components/Icono.js';
import Kpi from '../components/Kpi.js';
import TablaLeads, { type LeadFila as Lead } from '../components/TablaLeads.js';

interface Stats { total: number; ultimos30: number; sinContactar: number }

export default function Leads() {
  const [q, setQ] = useState('');
  const [stageId, setStageId] = useState('');
  const [orden, setOrden] = useState<'actividad' | 'creacion'>('actividad');
  const [creando, setCreando] = useState(false);

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') });
  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stages'),
  });
  const leads = useQuery({
    queryKey: ['leads', q, stageId, orden],
    queryFn: () =>
      api.get<{ total: number; leads: Lead[] }>(
        `/leads?${new URLSearchParams({
          ...(q ? { q } : {}),
          ...(stageId ? { stageId } : {}),
          orden,
        })}`
      ),
    /**
     * Un lead entra por un webhook, no por algo que el asesor haga en esta pantalla: sin
     * refresco habría que recargar para enterarse. Se sondea cada 20 s y además al volver
     * a la pestaña, que es cuando de verdad se mira.
     */
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    // Que el sondeo no parpadee la lista mientras se lee.
    placeholderData: (previo) => previo,
  });

  return (
    <>
      <div className="kpis">
        <Kpi titulo="Leads activos" icono="leads" tono="solido" valor={String(stats.data?.total ?? '—')} nota="en todas las etapas abiertas" />
        <Kpi titulo="Últimos 30 días" icono="calendario" valor={String(stats.data?.ultimos30 ?? '—')} nota="leads que entraron" />
        <Kpi titulo="Sin contactar" icono="alerta" tono="ambar" valor={String(stats.data?.sinContactar ?? '—')} nota="esperando la primera llamada" />
        <Kpi titulo="En esta vista" icono="buscar" tono="navy" valor={String(leads.data?.total ?? '—')} nota="con los filtros actuales" />
      </div>

      <div className="herramientas">
        <div className="buscador">
          <Icono nombre="buscar" tam={15} />
          <input placeholder="Buscar nombre, teléfono, DNI…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="control" style={{ margin: 0 }}>
          <select value={stageId} onChange={(e) => setStageId(e.target.value)} aria-label="Etapa">
            <option value="">Todas las etapas</option>
            {stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        <label className="control" style={{ margin: 0 }}>
          <select
            value={orden}
            onChange={(e) => setOrden(e.target.value as typeof orden)}
            aria-label="Orden de la lista"
          >
            <option value="actividad">Actividad reciente</option>
            <option value="creacion">Fecha de creación</option>
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        <span className="empuja" />
        <button type="button" className="btn" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={15} />Nuevo lead
        </button>
      </div>

      {creando && <NuevoLead onCerrar={() => setCreando(false)} />}

      {leads.isLoading && <div className="vacio">Cargando leads…</div>}
      {leads.data?.leads.length === 0 && (
        <div className="vacio">No hay leads con estos filtros.</div>
      )}
      {leads.data && leads.data.leads.length > 0 && (
        <div className="tabla-marco panel-lista">
          <TablaLeads leads={leads.data.leads} />
        </div>
      )}
    </>
  );
}
