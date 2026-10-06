import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { desde } from '../lib/format.js';
import Icono from '../components/Icono.js';
import { ChipInteres } from '../components/NivelInteres.js';
import MotivoPerdida from '../components/MotivoPerdida.js';

interface Etapa { id: string; name: string; color: string | null; isWon: boolean; isLost: boolean }
interface Tarjeta {
  id: string;
  stageId: string | null;
  createdAt: string;
  lastActivityAt: string | null;
  firstContactAt: string | null;
  interestLevel: number | null;
  source: string;
  unread: number;
  contact: { fname: string; lname: string | null; phone: string | null };
  project: { id: string; name: string } | null;
  unit: { code: string } | null;
  owner: { id: string; name: string } | null;
}
interface Datos { etapas: Etapa[]; leads: Tarjeta[] }

/**
 * Tablero Kanban: una columna por etapa, arrastrar para mover.
 *
 * La lista ordena por actividad y sirve para «qué pasó hoy». El tablero responde otra
 * pregunta: «cuántos tengo en cada punto del embudo y a quién le toca empujar». Las
 * columnas son las etapas de Ajustes → Embudo, así que cada inmobiliaria ve su proceso
 * (invitado a caseta, visitó, cotizado...) y no uno genérico.
 *
 * Arrastrar usa el drag and drop nativo del navegador: sin dependencia y suficiente para
 * escritorio. En el celular no hay arrastre fiable, así que cada tarjeta tiene un
 * desplegable «Mover a». Mover a una etapa perdida abre el diálogo de motivo, que el
 * servidor exige.
 */
export default function Tablero({ rol }: { rol: string }) {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [pidiendoMotivo, setPidiendoMotivo] = useState<{ lead: Tarjeta; etapa: Etapa } | null>(null);
  const puedeMover = rol !== 'solo_lectura';
  const puedeFiltrarAsesor = rol !== 'asesor';

  const datos = useQuery({
    queryKey: ['tablero', projectId, ownerId],
    queryFn: () =>
      api.get<Datos>(
        `/leads/tablero?${new URLSearchParams({
          ...(projectId ? { projectId } : {}),
          ...(ownerId ? { ownerId } : {}),
        })}`
      ),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: (previo) => previo,
  });
  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; role: string; active: boolean }[]>('/users'),
    enabled: puedeFiltrarAsesor,
  });

  const mover = useMutation({
    mutationFn: (v: { leadId: string; stageId: string; reason?: string }) =>
      api.patch(`/leads/${v.leadId}`, { stageId: v.stageId, reason: v.reason }),
    // Optimista: la tarjeta cambia de columna al soltar; si el servidor falla, vuelve.
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['tablero'] });
      const previo = qc.getQueryData<Datos>(['tablero', projectId, ownerId]);
      if (previo) {
        const destino = previo.etapas.find((e) => e.id === v.stageId);
        qc.setQueryData<Datos>(['tablero', projectId, ownerId], {
          ...previo,
          leads: previo.leads
            .map((l) => (l.id === v.leadId ? { ...l, stageId: v.stageId } : l))
            // Si va a ganado o perdido, deja de ser activo y sale del tablero.
            .filter((l) => !(l.id === v.leadId && destino && (destino.isWon || destino.isLost))),
        });
      }
      return { previo };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previo) qc.setQueryData(['tablero', projectId, ownerId], ctx.previo);
    },
    onSuccess: () => setPidiendoMotivo(null),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tablero'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const porEtapa = useMemo(() => {
    const m = new Map<string, Tarjeta[]>();
    for (const l of datos.data?.leads ?? []) {
      const k = l.stageId ?? '_sin';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return m;
  }, [datos.data]);

  function soltar(lead: Tarjeta, etapa: Etapa) {
    if (!puedeMover || lead.stageId === etapa.id) return;
    if (etapa.isLost) {
      setPidiendoMotivo({ lead, etapa });
      return;
    }
    mover.mutate({ leadId: lead.id, stageId: etapa.id });
  }

  const etapas = datos.data?.etapas ?? [];
  const sinEtapa = porEtapa.get('_sin') ?? [];

  return (
    <>
      <div className="herramientas">
        <label className="control" style={{ margin: 0 }}>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Proyecto">
            <option value="">Todos los proyectos</option>
            {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <Icono nombre="abajo" tam={14} />
        </label>
        {puedeFiltrarAsesor && (
          <label className="control" style={{ margin: 0 }}>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} aria-label="Asesor">
              <option value="">Todos los asesores</option>
              <option value="sin">Sin asignar</option>
              {usuarios.data?.filter((u) => u.active && u.role !== 'solo_lectura').map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            <Icono nombre="abajo" tam={14} />
          </label>
        )}
        <span className="empuja" />
        <span className="meta">
          {datos.data ? `${datos.data.leads.length} leads abiertos` : ''}
          {' · '}
          <Link to="/leads">Ver como lista</Link>
        </span>
      </div>

      {datos.isLoading && <div className="vacio">Cargando tablero…</div>}
      {mover.isError && !pidiendoMotivo && (
        <p className="error">{(mover.error as ApiError).message}</p>
      )}

      {datos.data && (
        <div className="tablero">
          {etapas.map((etapa) => {
            const tarjetas = porEtapa.get(etapa.id) ?? [];
            const cerrada = etapa.isWon || etapa.isLost;
            return (
              <section
                key={etapa.id}
                className={`columna ${sobre === etapa.id && arrastrando ? 'columna-sobre' : ''} ${cerrada ? 'columna-cerrada' : ''}`}
                onDragOver={(e) => {
                  if (!arrastrando) return;
                  e.preventDefault();
                  if (sobre !== etapa.id) setSobre(etapa.id);
                }}
                onDragLeave={() => setSobre((s) => (s === etapa.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const lead = datos.data!.leads.find((l) => l.id === arrastrando);
                  setArrastrando(null); setSobre(null);
                  if (lead) soltar(lead, etapa);
                }}
              >
                <header className="columna-cab">
                  <span className="estado">
                    <i style={{ background: etapa.color ?? 'var(--tenue)' }} />
                    {etapa.name}
                  </span>
                  <span className="chip chip-gris">{tarjetas.length}</span>
                </header>
                {cerrada && tarjetas.length === 0 && (
                  <p className="meta columna-nota">
                    {etapa.isWon ? 'Suelta aquí los que compraron.' : 'Suelta aquí los que se pierden; se pide el motivo.'}
                  </p>
                )}
                <div className="columna-cuerpo">
                  {tarjetas.map((l) => (
                    <TarjetaLead
                      key={l.id}
                      lead={l}
                      etapas={etapas}
                      puedeMover={puedeMover}
                      arrastrando={arrastrando === l.id}
                      onDragStart={() => setArrastrando(l.id)}
                      onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                      onMover={(stageId) => {
                        const destino = etapas.find((e) => e.id === stageId);
                        if (destino) soltar(l, destino);
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {sinEtapa.length > 0 && (
            <section className="columna">
              <header className="columna-cab">
                <span className="estado"><i style={{ background: 'var(--tenue)' }} />Sin etapa</span>
                <span className="chip chip-gris">{sinEtapa.length}</span>
              </header>
              <div className="columna-cuerpo">
                {sinEtapa.map((l) => (
                  <TarjetaLead
                    key={l.id}
                    lead={l}
                    etapas={etapas}
                    puedeMover={puedeMover}
                    arrastrando={arrastrando === l.id}
                    onDragStart={() => setArrastrando(l.id)}
                    onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                    onMover={(stageId) => {
                      const destino = etapas.find((e) => e.id === stageId);
                      if (destino) soltar(l, destino);
                    }}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {pidiendoMotivo && (
        <MotivoPerdida
          nombre={`${pidiendoMotivo.lead.contact.fname} ${pidiendoMotivo.lead.contact.lname ?? ''}`.trim()}
          etapa={pidiendoMotivo.etapa.name}
          pendiente={mover.isPending}
          error={mover.isError ? (mover.error as ApiError).message : null}
          onConfirmar={(motivo) =>
            mover.mutate({ leadId: pidiendoMotivo.lead.id, stageId: pidiendoMotivo.etapa.id, reason: motivo })
          }
          onCancelar={() => { setPidiendoMotivo(null); mover.reset(); }}
        />
      )}
    </>
  );
}

function TarjetaLead({
  lead: l,
  etapas,
  puedeMover,
  arrastrando,
  onDragStart,
  onDragEnd,
  onMover,
}: {
  lead: Tarjeta;
  etapas: Etapa[];
  puedeMover: boolean;
  arrastrando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMover: (stageId: string) => void;
}) {
  const sinContactar = !l.firstContactAt && (Date.now() - new Date(l.createdAt).getTime()) / 60000 > 15;
  return (
    <article
      className={`tarjeta ${arrastrando ? 'tarjeta-arrastrando' : ''}`}
      draggable={puedeMover}
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(); }}
      onDragEnd={onDragEnd}
    >
      <div className="fila" style={{ alignItems: 'flex-start' }}>
        <Link to={`/leads/${l.id}`} className="nombre tarjeta-nombre">
          {l.unread > 0 && <span className="punto" aria-hidden="true" />}
          {l.contact.fname} {l.contact.lname ?? ''}
        </Link>
        <ChipInteres nivel={l.interestLevel} compacto />
      </div>
      <div className="meta" style={{ marginTop: 3 }}>
        {[l.project?.name, l.unit?.code && `Unidad ${l.unit.code}`].filter(Boolean).join(' · ') || 'Sin proyecto'}
      </div>
      <div className="fila" style={{ marginTop: 8 }}>
        <span className="meta">{desde(l.lastActivityAt ?? l.createdAt)} · {l.owner?.name ?? 'sin asignar'}</span>
        {sinContactar && <span className="chip chip-alerta">Sin contactar</span>}
        {l.unread > 0 && <span className="chip chip-verde">{l.unread} sin leer</span>}
      </div>
      {puedeMover && (
        <select
          className="tarjeta-mover solo-movil"
          value={l.stageId ?? ''}
          onChange={(e) => e.target.value && onMover(e.target.value)}
          aria-label="Mover a etapa"
        >
          <option value="">Mover a…</option>
          {etapas.filter((e) => e.id !== l.stageId).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
    </article>
  );
}
