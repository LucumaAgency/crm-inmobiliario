import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fecha, precio, whatsappUrl } from '../lib/format.js';
import ChatWhatsApp from './ChatWhatsApp.js';

interface Detalle {
  id: string;
  createdAt: string;
  firstContactAt: string | null;
  message: string | null;
  source: string;
  attribution: Record<string, unknown> | null;
  contact: { fname: string; lname: string | null; phone: string | null; email: string | null; document: string | null };
  project: { id: string; name: string } | null;
  unit: { code: string; price: string | null; currency: string; areaM2: string | null; bedrooms: number | null } | null;
  stage: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
  activities: { id: string; type: string; body: string | null; createdAt: string; dueAt: string | null; doneAt: string | null; user: { name: string } | null }[];
}

const TIPOS = ['llamada', 'whatsapp', 'email', 'visita', 'nota'] as const;
const TIPOS_SEGUIMIENTO = ['llamada', 'whatsapp', 'email', 'visita'] as const;

export default function LeadDetail({ rol }: { rol: string }) {
  const { id } = useParams();
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('llamada');
  const [body, setBody] = useState('');
  const [nextDueAt, setNextDueAt] = useState('');
  const [nextType, setNextType] = useState<(typeof TIPOS_SEGUIMIENTO)[number]>('llamada');
  const [segTipo, setSegTipo] = useState<(typeof TIPOS_SEGUIMIENTO)[number]>('llamada');
  const [segFecha, setSegFecha] = useState('');
  const [segNota, setSegNota] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.get<Detalle>(`/leads/${id}`),
  });
  const stages = useQuery({
    queryKey: ['stages'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stages'),
  });

  const registrar = useMutation({
    mutationFn: () =>
      api.post(`/leads/${id}/activities`, {
        type: tipo,
        body: body || undefined,
        nextDueAt: nextDueAt ? new Date(nextDueAt).toISOString() : undefined,
        nextType: nextDueAt ? nextType : undefined,
      }),
    onSuccess: (res) => {
      setBody(''); setNextDueAt('');
      const n = (res as { seguimientosCerrados?: number }).seguimientosCerrados ?? 0;
      setAviso(n > 0 ? (n === 1 ? 'Se cerró 1 seguimiento pendiente.' : `Se cerraron ${n} seguimientos pendientes.`) : null);
      refrescar();
    },
  });

  const agendar = useMutation({
    mutationFn: () =>
      api.post(`/leads/${id}/seguimientos`, {
        type: segTipo,
        dueAt: new Date(segFecha).toISOString(),
        body: segNota.trim() || undefined,
      }),
    onSuccess: () => {
      setSegFecha(''); setSegNota('');
      refrescar();
    },
  });

  const hecho = useMutation({
    mutationFn: (segId: string) => api.patch(`/leads/seguimientos/${segId}`, { hecho: true }),
    onSuccess: refrescar,
  });

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['lead', id] });
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['seguimientos'] });
  }

  const cambiarEtapa = useMutation({
    mutationFn: (stageId: string) => api.patch(`/leads/${id}`, { stageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead', id] }),
  });

  if (isLoading || !lead) return <div className="vacio">Cargando…</div>;

  const nombre = `${lead.contact.fname} ${lead.contact.lname ?? ''}`.trim();
  const pendientes = lead.activities
    .filter((a) => a.dueAt && !a.doneAt)
    .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!));
  const wa = whatsappUrl(
    lead.contact.phone,
    `Hola ${lead.contact.fname}, te escribo de ${lead.project?.name ?? 'la inmobiliaria'} por tu consulta.`
  );

  return (
    <>
      <div className="card">
        <div className="fila">
          <h2 style={{ margin: 0, fontSize: 19 }}>{nombre}</h2>
          {!lead.firstContactAt && <span className="chip chip-alerta">Sin contactar</span>}
        </div>
        <div className="meta" style={{ marginTop: 6 }}>
          {lead.contact.phone ?? 'sin teléfono'} · {lead.contact.email ?? 'sin correo'}
          {lead.contact.document ? ` · DNI ${lead.contact.document}` : ''}
        </div>

        <div className="acciones">
          {wa && <a className="btn btn-wa" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
          {lead.contact.phone && <a className="btn btn-sec" href={`tel:${lead.contact.phone}`}>Llamar</a>}
          {lead.contact.email && <a className="btn btn-sec" href={`mailto:${lead.contact.email}`}>Correo</a>}
        </div>

        <label>Etapa</label>
        <select
          value={lead.stage?.id ?? ''}
          onChange={(e) => cambiarEtapa.mutate(e.target.value)}
          disabled={rol === 'solo_lectura'}
        >
          {stages.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="meta" style={{ marginTop: 12 }}>
          Entró {fecha(lead.createdAt)} · fuente {lead.source} · asesor {lead.owner?.name ?? 'sin asignar'}
        </div>
      </div>

      {(lead.project || lead.unit) && (
        <div className="card">
          <strong>Interés</strong>
          <div className="meta" style={{ marginTop: 6 }}>
            {lead.project?.name}
            {lead.unit && ` · Unidad ${lead.unit.code} · ${lead.unit.bedrooms ?? '?'} dorm · ${lead.unit.areaM2 ?? '?'} m² · ${precio(lead.unit.price, lead.unit.currency)}`}
          </div>
          {lead.message && <p style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{lead.message}</p>}
        </div>
      )}

      {rol !== 'solo_lectura' && <ChatWhatsApp leadId={lead.id} />}

      <div className="card">
        <strong>Seguimientos</strong>
        {pendientes.length === 0 ? (
          <p className="meta" style={{ marginTop: 6 }}>
            Sin próximo paso agendado. Un lead sin próxima acción se enfría.
          </p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {pendientes.map((a) => {
              const vencido = new Date(a.dueAt!).getTime() < Date.now();
              return (
                <div key={a.id} className="fila" style={{ padding: '8px 0', borderBottom: '1px solid var(--borde-suave)' }}>
                  <span>
                    <span className={vencido ? 'chip chip-alerta' : 'chip chip-gris'}>{fecha(a.dueAt)}</span>{' '}
                    <span className="nombre" style={{ fontSize: 13.5 }}>{a.type}</span>
                    {a.body && a.body !== 'Seguimiento agendado' && <span className="meta"> · {a.body}</span>}
                  </span>
                  {rol !== 'solo_lectura' && (
                    <button
                      type="button"
                      className="btn btn-sec"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      disabled={hecho.isPending}
                      onClick={() => hecho.mutate(a.id)}
                    >
                      Hecho
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {rol !== 'solo_lectura' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (segFecha) agendar.mutate();
            }}
          >
            <div className="rejilla-2">
              <div>
                <label>Agendar</label>
                <select value={segTipo} onChange={(e) => setSegTipo(e.target.value as typeof segTipo)}>
                  {TIPOS_SEGUIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label>Cuándo</label>
                <input type="datetime-local" value={segFecha} onChange={(e) => setSegFecha(e.target.value)} required />
              </div>
            </div>
            <label>Nota (opcional)</label>
            <input value={segNota} onChange={(e) => setSegNota(e.target.value)} placeholder="Ej.: enviar cotización del depa 302" maxLength={200} />
            <button className="btn" style={{ marginTop: 12 }} disabled={!segFecha || agendar.isPending}>
              Agendar seguimiento
            </button>
          </form>
        )}
      </div>

      {rol !== 'solo_lectura' && (
        <div className="card">
          <strong>Registrar actividad</strong>
          <label>Qué pasó</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <label>Detalle</label>
          <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Qué se conversó" />
          <div className="rejilla-2">
            <div>
              <label>Siguiente seguimiento</label>
              <input type="datetime-local" value={nextDueAt} onChange={(e) => setNextDueAt(e.target.value)} />
            </div>
            <div>
              <label>Tipo</label>
              <select value={nextType} onChange={(e) => setNextType(e.target.value as typeof nextType)}>
                {TIPOS_SEGUIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="meta" style={{ marginTop: 6 }}>
            Registrar una llamada, WhatsApp, correo o visita cierra los seguimientos de hoy y los
            vencidos de este lead. Agenda siempre el siguiente paso.
          </p>
          <button
            className="btn btn-bloque"
            onClick={() => registrar.mutate()}
            disabled={registrar.isPending}
          >
            {registrar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          {aviso && <p className="ok">{aviso}</p>}
        </div>
      )}

      <div className="card">
        <strong>Historial</strong>
        <div className="timeline" style={{ marginTop: 12 }}>
          {lead.activities.length === 0 && <p className="meta">Sin actividades todavía.</p>}
          {lead.activities.map((a) => (
            <div key={a.id} className="evento">
              <div className="fila">
                <span className="nombre" style={{ fontSize: 14 }}>{a.type.replace('_', ' ')}</span>
                <span className="meta">{fecha(a.createdAt)}</span>
              </div>
              {a.body && <div className="meta" style={{ whiteSpace: 'pre-wrap' }}>{a.body}</div>}
              {a.dueAt && !a.doneAt && <span className="chip chip-alerta">Pendiente {fecha(a.dueAt)}</span>}
              {a.dueAt && a.doneAt && <span className="chip chip-verde">Cumplido {fecha(a.doneAt)}</span>}
              {a.user && <div className="meta">{a.user.name}</div>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
