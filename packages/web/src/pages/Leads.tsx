import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { desde } from '../lib/format.js';
import NuevoLead from './NuevoLead.js';

interface Lead {
  id: string;
  createdAt: string;
  firstContactAt: string | null;
  source: string;
  contact: { fname: string; lname: string | null; phone: string | null; email: string | null };
  project: { name: string } | null;
  unit: { code: string } | null;
  stage: { name: string; color: string | null } | null;
  owner: { name: string } | null;
}

interface Stats { total: number; ultimos30: number; sinContactar: number }

export default function Leads() {
  const [q, setQ] = useState('');
  const [stageId, setStageId] = useState('');
  const [creando, setCreando] = useState(false);

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') });
  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stages'),
  });
  const leads = useQuery({
    queryKey: ['leads', q, stageId],
    queryFn: () =>
      api.get<{ total: number; leads: Lead[] }>(
        `/leads?${new URLSearchParams({ ...(q ? { q } : {}), ...(stageId ? { stageId } : {}) })}`
      ),
  });

  return (
    <>
      <div className="stats">
        <div className="stat"><div className="n">{stats.data?.total ?? '—'}</div><div className="t">Leads activos</div></div>
        <div className="stat"><div className="n">{stats.data?.ultimos30 ?? '—'}</div><div className="t">Últimos 30 días</div></div>
        <div className="stat"><div className="n">{stats.data?.sinContactar ?? '—'}</div><div className="t">Sin contactar</div></div>
        <div className="stat"><div className="n">{leads.data?.total ?? '—'}</div><div className="t">En esta vista</div></div>
      </div>

      <div className="barra-acciones">
        <div className="filtros">
          <input placeholder="Buscar nombre, teléfono, DNI…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
            <option value="">Todas las etapas</option>
            {stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn" onClick={() => setCreando(true)}>+ Nuevo lead</button>
      </div>

      {creando && <NuevoLead onCerrar={() => setCreando(false)} />}

      {leads.isLoading && <div className="vacio">Cargando leads…</div>}
      {leads.data?.leads.length === 0 && (
        <div className="vacio">No hay leads con estos filtros.</div>
      )}

      {leads.data?.leads.map((l) => {
        const minutos = (Date.now() - new Date(l.createdAt).getTime()) / 60000;
        const enRiesgo = !l.firstContactAt && minutos > 15;
        return (
          <Link key={l.id} to={`/leads/${l.id}`} className="card card-lead">
            <div className="fila">
              <span className="nombre">{l.contact.fname} {l.contact.lname ?? ''}</span>
              {l.stage && (
                <span className="chip" style={l.stage.color ? { background: l.stage.color + '22', color: l.stage.color } : undefined}>
                  {l.stage.name}
                </span>
              )}
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              {[l.project?.name, l.unit?.code && `Unidad ${l.unit.code}`, l.contact.phone]
                .filter(Boolean)
                .join(' · ')}
            </div>
            <div className="fila" style={{ marginTop: 8 }}>
              <span className="meta">{desde(l.createdAt)} · {l.owner?.name ?? 'sin asignar'}</span>
              {enRiesgo && <span className="chip chip-alerta">Sin contactar</span>}
            </div>
          </Link>
        );
      })}
    </>
  );
}
