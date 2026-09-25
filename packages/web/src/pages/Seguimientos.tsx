import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';
import Kpi from '../components/Kpi.js';

interface Seguimiento {
  id: string;
  type: string;
  body: string | null;
  dueAt: string;
  lead: {
    id: string;
    contact: { fname: string; lname: string | null; phone: string | null };
    project: { name: string } | null;
    owner: { id: string; name: string } | null;
  };
}

const TIPOS: Record<string, string> = {
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
const diaYHora = (iso: string) =>
  new Date(iso).toLocaleString('es-PE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Valor para <input type="datetime-local"> en la hora local del navegador. */
function paraInput(d: Date) {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function manana9() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/** Una fila: quién, qué, cuándo, y las dos acciones que se hacen sin abrir la ficha. */
function Fila({
  s,
  vencido,
  mostrarAsesor,
  puedeEditar,
}: {
  s: Seguimiento;
  vencido: boolean;
  mostrarAsesor: boolean;
  puedeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [reprogramando, setReprogramando] = useState(false);
  const [nueva, setNueva] = useState(paraInput(manana9()));

  const cambiar = useMutation({
    mutationFn: (datos: { hecho?: true; dueAt?: string }) => api.patch(`/leads/seguimientos/${s.id}`, datos),
    onSuccess: () => {
      setReprogramando(false);
      qc.invalidateQueries({ queryKey: ['seguimientos'] });
      qc.invalidateQueries({ queryKey: ['lead', s.lead.id] });
    },
  });

  const nombre = `${s.lead.contact.fname} ${s.lead.contact.lname ?? ''}`.trim();
  return (
    <div className="seg-fila">
      <div className="seg-cuando">
        <span className={vencido ? 'chip chip-alerta' : 'chip chip-gris'}>
          {vencido ? diaYHora(s.dueAt) : hora(s.dueAt)}
        </span>
      </div>
      <div className="seg-quien">
        <Link to={`/leads/${s.lead.id}`} className="nombre" style={{ color: 'inherit' }}>{nombre}</Link>
        <div className="meta">
          {[TIPOS[s.type] ?? s.type, s.lead.project?.name, s.lead.contact.phone].filter(Boolean).join(' · ')}
        </div>
        {s.body && s.body !== 'Seguimiento agendado' && <div className="meta seg-nota">{s.body}</div>}
        {mostrarAsesor && (
          <div className="meta">Asesor: {s.lead.owner?.name ?? <em>sin asignar</em>}</div>
        )}
      </div>
      {puedeEditar && (
        <div className="seg-acciones">
          {reprogramando ? (
            <>
              <input
                type="datetime-local"
                value={nueva}
                onChange={(e) => setNueva(e.target.value)}
                style={{ padding: '6px 8px', fontSize: 13, maxWidth: 200 }}
              />
              <button
                type="button"
                className="btn"
                style={{ padding: '6px 10px' }}
                disabled={!nueva || cambiar.isPending}
                onClick={() => cambiar.mutate({ dueAt: new Date(nueva).toISOString() })}
              >
                Guardar
              </button>
              <button type="button" className="btn btn-sec" style={{ padding: '6px 10px' }} onClick={() => setReprogramando(false)}>
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sec"
                style={{ padding: '6px 10px' }}
                onClick={() => setReprogramando(true)}
              >
                <Icono nombre="calendario" tam={14} />Reprogramar
              </button>
              <button
                type="button"
                className="btn"
                style={{ padding: '6px 10px' }}
                disabled={cambiar.isPending}
                onClick={() => cambiar.mutate({ hecho: true })}
              >
                <Icono nombre="check" tam={14} />Hecho
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Seguimientos: el próximo contacto con cada lead. Es la pantalla con la que el asesor
 * abre el día. Se cierran con «Hecho» o, solos, al registrar un contacto en la ficha.
 */
export default function Seguimientos({ rol }: { rol: string }) {
  const gestiona = rol !== 'asesor';
  const puedeEditar = rol !== 'solo_lectura';
  const [vista, setVista] = useState<'mios' | 'equipo'>(rol === 'solo_lectura' ? 'equipo' : 'mios');
  const [asesor, setAsesor] = useState('');

  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; active: boolean }[]>('/users'),
    enabled: gestiona && rol !== 'solo_lectura',
  });
  const { data, isLoading } = useQuery({
    queryKey: ['seguimientos', vista, asesor],
    queryFn: () =>
      api.get<Seguimiento[]>(
        `/leads/seguimientos?${new URLSearchParams({ vista, ...(vista === 'equipo' && asesor ? { asesor } : {}) })}`
      ),
    refetchInterval: 60_000,
    placeholderData: (previo) => previo,
  });

  const ahora = Date.now();
  const finHoy = new Date();
  finHoy.setHours(23, 59, 59, 999);
  const lista = data ?? [];
  const vencidos = lista.filter((s) => new Date(s.dueAt).getTime() < ahora);
  const hoy = lista.filter((s) => {
    const t = new Date(s.dueAt).getTime();
    return t >= ahora && t <= finHoy.getTime();
  });
  const proximos = lista.filter((s) => new Date(s.dueAt).getTime() > finHoy.getTime());
  const mostrarAsesor = vista === 'equipo';

  const grupo = (titulo: string, items: Seguimiento[], vencido: boolean, vacio: string) => (
    <section className="panel">
      <div className="panel-cab" style={{ paddingBottom: 12 }}>
        <h2 className="titulo-panel">
          {titulo} <span className="chip chip-gris">{items.length}</span>
        </h2>
      </div>
      <div style={{ borderTop: '1px solid var(--borde)' }}>
        {items.length === 0 ? (
          <div className="meta" style={{ padding: 16 }}>{vacio}</div>
        ) : (
          items.map((s) => (
            <Fila key={s.id} s={s} vencido={vencido} mostrarAsesor={mostrarAsesor} puedeEditar={puedeEditar} />
          ))
        )}
      </div>
    </section>
  );

  return (
    <>
      {gestiona && (
        <div className="herramientas">
          <div className="pestanas" style={{ marginBottom: 0 }}>
            {rol !== 'solo_lectura' && (
              <button type="button" className={vista === 'mios' ? 'activa' : ''} onClick={() => setVista('mios')}>
                Míos
              </button>
            )}
            <button type="button" className={vista === 'equipo' ? 'activa' : ''} onClick={() => setVista('equipo')}>
              Todo el equipo
            </button>
          </div>
          {vista === 'equipo' && usuarios.data && (
            <label className="control" style={{ margin: 0 }}>
              <Icono nombre="cuenta" tam={15} />
              <select value={asesor} onChange={(e) => setAsesor(e.target.value)} aria-label="Asesor">
                <option value="">Todos los asesores</option>
                {usuarios.data.filter((u) => u.active).map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
                <option value="sin">Leads sin asignar</option>
              </select>
              <Icono nombre="abajo" tam={14} />
            </label>
          )}
        </div>
      )}

      <div className="kpis">
        <Kpi titulo="Vencidos" icono="alerta" tono="ambar" valor={String(vencidos.length)} nota="ya debieron hacerse" />
        <Kpi titulo="Para hoy" icono="reloj" tono="solido" valor={String(hoy.length)} nota="lo que queda del día" />
        <Kpi titulo="Próximos" icono="calendario" valor={String(proximos.length)} nota="de mañana en adelante" />
        <Kpi titulo="Total pendiente" icono="tareas" tono="navy" valor={String(lista.length)} nota={mostrarAsesor ? 'del equipo' : 'tuyos'} />
      </div>

      {isLoading && <div className="vacio">Cargando…</div>}
      {!isLoading && (
        <>
          {vencidos.length > 0 && grupo('Vencidos', vencidos, true, '')}
          {grupo('Hoy', hoy, false, 'Nada más para hoy.')}
          {grupo('Próximos', proximos, false, 'Sin seguimientos agendados más adelante.')}
        </>
      )}
      <p className="meta" style={{ textAlign: 'center' }}>
        Registrar una llamada, WhatsApp, correo o visita en la ficha del lead cierra solo sus seguimientos de hoy y los vencidos.
      </p>
    </>
  );
}
