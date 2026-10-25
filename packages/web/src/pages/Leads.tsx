import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import NuevoLead from './NuevoLead.js';
import Icono from '../components/Icono.js';
import Kpi from '../components/Kpi.js';
import TablaLeads, { type LeadFila as Lead } from '../components/TablaLeads.js';
import BorrarLeads from '../components/BorrarLeads.js';
import { usePuede } from '../lib/permisos.js';
import { usaSperant } from '@lucuma-crm/shared';
import { FUENTES } from '../lib/reportes.js';
import { useNivelesInteres } from '../components/NivelInteres.js';

const POR_PAGINA = 50;

interface Stats { total: number; ultimos30: number; sinContactar: number }

export default function Leads() {
  const [q, setQ] = useState('');
  const [stageId, setStageId] = useState('');
  const [orden, setOrden] = useState<'actividad' | 'creacion'>('actividad');
  const [creando, setCreando] = useState(false);
  // Un solo desplegable de origen: el canal (`source`) o, en Bastión, si vino de Sperant.
  const [origen, setOrigen] = useState('');
  const [interes, setInteres] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [pagina, setPagina] = useState(1);
  const puede = usePuede();
  const puedeBorrar = puede('leads.borrar');
  const veEquipo = puede('leads.ver_todos');
  const niveles = useNivelesInteres();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<{ organization: { slug: string } | null }>('/auth/me') });
  const conSperant = usaSperant(me.data?.organization?.slug);
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; active: boolean }[]>('/users'),
    enabled: veEquipo,
  });
  // Se guarda el lead entero y no solo el id: la selección sobrevive al cambiar de página.
  const [seleccion, setSeleccion] = useState<Map<string, Lead>>(new Map());
  const [borrando, setBorrando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api.get<Stats>('/stats') });
  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stages'),
  });
  const leads = useQuery({
    queryKey: ['leads', q, stageId, orden, origen, interes, ownerId, pagina],
    queryFn: () =>
      api.get<{ total: number; leads: Lead[] }>(
        `/leads?${new URLSearchParams({
          ...(q ? { q } : {}),
          ...(stageId ? { stageId } : {}),
          ...(origen === 'sperant' || origen === 'crm' ? { origen } : origen ? { source: origen } : {}),
          ...(interes ? { interes } : {}),
          ...(ownerId ? { ownerId } : {}),
          orden,
          page: String(pagina),
          perPage: String(POR_PAGINA),
        })}`
      ),
    /**
     * Un lead entra por un webhook, no por algo que el asesor haga en esta pantalla: sin
     * refresco habría que recargar para enterarse. Se sondea cada 8 s y además al volver
     * a la pestaña, que es cuando de verdad se mira.
     */
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    // Que el sondeo no parpadee la lista mientras se lee.
    placeholderData: (previo) => previo,
  });

  const paginas = Math.max(1, Math.ceil((leads.data?.total ?? 0) / POR_PAGINA));
  // Cambiar un filtro vuelve a la primera página.
  function filtrar<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPagina(1);
    };
  }
  function marcar(ids: string[], marcado: boolean) {
    setSeleccion((previo) => {
      const nueva = new Map(previo);
      for (const id of ids) {
        const l = leads.data?.leads.find((x) => x.id === id);
        if (marcado && l) nueva.set(id, l);
        else nueva.delete(id);
      }
      return nueva;
    });
  }
  const deSperant = [...seleccion.values()].filter((l) => l.attribution?.sperant).length;

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
          <input placeholder="Buscar nombre, teléfono, DNI…" value={q} onChange={(e) => filtrar(setQ)(e.target.value)} />
        </div>
        <label className="control" style={{ margin: 0 }}>
          <select value={stageId} onChange={(e) => filtrar(setStageId)(e.target.value)} aria-label="Etapa">
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
        <label className="control" style={{ margin: 0 }}>
          <select
            value={origen}
            onChange={(e) => filtrar(setOrigen)(e.target.value)}
            aria-label="Origen"
          >
            <option value="">Todos los orígenes</option>
            {Object.entries(FUENTES).map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
            {conSperant && (
              <>
                <option value="crm">Creados en el CRM</option>
                <option value="sperant">Importados de Sperant</option>
              </>
            )}
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        <label className="control" style={{ margin: 0 }}>
          <select value={interes} onChange={(e) => filtrar(setInteres)(e.target.value)} aria-label="Nivel de interés">
            <option value="">Todo nivel de interés</option>
            {[3, 2, 1].map((n) => <option key={n} value={String(n)}>{niveles[n - 1]}</option>)}
            <option value="sin">Sin nivel</option>
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        {veEquipo && (
          <label className="control" style={{ margin: 0 }}>
            <select value={ownerId} onChange={(e) => filtrar(setOwnerId)(e.target.value)} aria-label="Asesor">
              <option value="">Todos los asesores</option>
              {usuarios.data?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              <option value="sin">Sin asignar</option>
            </select>
            <Icono nombre="abajo" tam={14} />
          </label>
        )}
        <span className="empuja" />
        <button type="button" className="btn" onClick={() => setCreando(true)}>
          <Icono nombre="mas" tam={15} />Nuevo lead
        </button>
      </div>

      {creando && <NuevoLead onCerrar={() => setCreando(false)} />}

      {aviso && (
        <div className="card" style={{ marginBottom: 10 }}>
          {aviso}{' '}
          <button type="button" className="btn btn-sec" onClick={() => setAviso(null)}>Cerrar</button>
        </div>
      )}

      {puedeBorrar && seleccion.size > 0 && (
        <div className="herramientas">
          <strong>{seleccion.size === 1 ? '1 lead seleccionado' : `${seleccion.size} leads seleccionados`}</strong>
          <button type="button" className="btn btn-sec" onClick={() => setSeleccion(new Map())}>Quitar selección</button>
          <span className="empuja" />
          <button
            type="button"
            className="btn btn-peligro"
            disabled={seleccion.size > 200}
            title={seleccion.size > 200 ? 'Máximo 200 por vez' : undefined}
            onClick={() => setBorrando(true)}
          >
            Borrar seleccionados
          </button>
        </div>
      )}

      {borrando && (
        <BorrarLeads
          ids={[...seleccion.keys()]}
          deSperant={deSperant}
          nombre={seleccion.size === 1 ? [...seleccion.values()].map((l) => `${l.contact.fname} ${l.contact.lname ?? ''}`.trim())[0] : undefined}
          onCerrar={() => setBorrando(false)}
          onBorrado={(r) => {
            setBorrando(false);
            setSeleccion(new Map());
            setAviso(
              `${r.borrados === 1 ? 'Se borró 1 lead' : `Se borraron ${r.borrados} leads`}` +
                (r.contactosBorrados ? ` y ${r.contactosBorrados === 1 ? '1 contacto' : `${r.contactosBorrados} contactos`} sin otros leads.` : '.'),
            );
          }}
        />
      )}

      {leads.isLoading && <div className="vacio">Cargando leads…</div>}
      {leads.data?.leads.length === 0 && (
        <div className="vacio">No hay leads con estos filtros.</div>
      )}
      {leads.data && leads.data.leads.length > 0 && (
        <div className="tabla-marco panel-lista">
          <TablaLeads
            leads={leads.data.leads}
            seleccion={puedeBorrar ? new Set(seleccion.keys()) : undefined}
            onSeleccion={puedeBorrar ? marcar : undefined}
          />
        </div>
      )}
      {paginas > 1 && (
        <div className="herramientas" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button type="button" className="btn btn-sec" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
            Anterior
          </button>
          <span className="meta">Página {pagina} de {paginas}</span>
          <button type="button" className="btn btn-sec" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
            Siguiente
          </button>
        </div>
      )}
    </>
  );
}
