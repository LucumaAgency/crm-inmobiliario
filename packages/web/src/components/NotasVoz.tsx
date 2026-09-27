import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fecha } from '../lib/format.js';
import Icono from './Icono.js';

type Tipo = 'llamada' | 'whatsapp' | 'email' | 'visita' | 'nota';

interface Nota {
  id: string;
  status: 'pendiente' | 'transcrita' | 'lista' | 'error';
  transcript: string | null;
  propuesta: {
    resumen: string;
    tipo: Tipo;
    siguientePaso: { tipo: Exclude<Tipo, 'nota'>; cuando: string | null; descripcion: string } | null;
  } | null;
  error: string | null;
  activityId: string | null;
  durationSec: number | null;
  createdAt: string;
  user: { name: string } | null;
}

const MAX_SEGUNDOS = 180;
const TIPOS: Tipo[] = ['llamada', 'whatsapp', 'email', 'visita', 'nota'];
const TIPOS_SEGUIMIENTO = ['llamada', 'whatsapp', 'email', 'visita'] as const;

/** Chrome y Android graban webm/opus; Safari (iPhone) solo mp4. */
function formatoGrabacion(): string | undefined {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

/** ISO con zona → valor de <input type="datetime-local"> en la hora del navegador. */
function paraInput(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Todavía se está procesando: hay que seguir preguntando. */
const enProceso = (n: Nota) =>
  n.status === 'pendiente' ||
  (n.status === 'transcrita' && !n.error) ||
  !!n.error?.startsWith('Reintentando');

/** La propuesta, editable. El asesor corrige lo que haga falta y la registra. */
function Revision({ nota, alRegistrar }: { nota: Nota; alRegistrar: () => void }) {
  const p = nota.propuesta;
  const [tipo, setTipo] = useState<Tipo>(p?.tipo ?? 'llamada');
  const [texto, setTexto] = useState(p?.resumen ?? nota.transcript ?? '');
  const [sigTipo, setSigTipo] = useState<(typeof TIPOS_SEGUIMIENTO)[number]>(p?.siguientePaso?.tipo ?? 'llamada');
  const [sigCuando, setSigCuando] = useState(paraInput(p?.siguientePaso?.cuando));
  const [sigDesc, setSigDesc] = useState(p?.siguientePaso?.descripcion ?? '');

  const registrar = useMutation({
    mutationFn: () =>
      api.post(`/leads/notas-voz/${nota.id}/registrar`, {
        type: tipo,
        body: texto.trim(),
        nextDueAt: sigCuando ? new Date(sigCuando).toISOString() : undefined,
        nextType: sigCuando ? sigTipo : undefined,
        nextBody: sigCuando ? sigDesc.trim() || undefined : undefined,
      }),
    onSuccess: alRegistrar,
  });

  return (
    <div className="voz-revision">
      <div className="rejilla-2">
        <div>
          <label>Qué pasó</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)}>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div />
      </div>
      <label>Resumen</label>
      <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} />
      <div className="rejilla-2">
        <div>
          <label>Siguiente seguimiento</label>
          <input type="datetime-local" value={sigCuando} onChange={(e) => setSigCuando(e.target.value)} />
        </div>
        <div>
          <label>Tipo</label>
          <select value={sigTipo} onChange={(e) => setSigTipo(e.target.value as typeof sigTipo)}>
            {TIPOS_SEGUIMIENTO.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <label>Qué hacer en el seguimiento</label>
      <input value={sigDesc} onChange={(e) => setSigDesc(e.target.value)} placeholder="Ej.: visita al piloto" maxLength={200} />
      {p?.siguientePaso && !p.siguientePaso.cuando && (
        <p className="meta" style={{ marginTop: 6 }}>La nota no dice cuándo: elige la fecha.</p>
      )}
      <div className="acciones">
        <button type="button" className="btn" disabled={!texto.trim() || registrar.isPending} onClick={() => registrar.mutate()}>
          <Icono nombre="check" tam={15} />Registrar actividad
        </button>
      </div>
      {registrar.isError && <p className="error">{(registrar.error as Error).message}</p>}
    </div>
  );
}

/**
 * Notas de voz del lead: grabar, esperar la propuesta, revisarla y registrarla.
 * Sirve aunque la llamada haya sido desde el WhatsApp personal del asesor.
 */
export default function NotasVoz({ leadId, puedeEditar }: { leadId: string; puedeEditar: boolean }) {
  const qc = useQueryClient();
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [verTexto, setVerTexto] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const inicio = useRef(0);

  const notas = useQuery({
    queryKey: ['notas-voz', leadId],
    queryFn: () => api.get<Nota[]>(`/leads/${leadId}/notas-voz`),
    // Mientras alguna se procesa, se pregunta cada 3 s; el resto del tiempo, nada.
    refetchInterval: (q) => ((q.state.data ?? []).some(enProceso) ? 3000 : false),
  });

  const subir = useMutation({
    mutationFn: async ({ blob, duracion }: { blob: Blob; duracion: number }) => {
      const fd = new FormData();
      // Los campos van ANTES del archivo: el servidor solo ve los que llegan antes.
      fd.append('duracion', String(duracion));
      fd.append('audio', blob, 'nota');
      const res = await fetch(`/api/v1/leads/${leadId}/notas-voz`, { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Error ${res.status}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notas-voz', leadId] }),
    onError: (e: Error) => setError(e.message),
  });

  const reintentar = useMutation({
    mutationFn: (id: string) => api.post(`/leads/notas-voz/${id}/reintentar`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notas-voz', leadId] }),
  });

  // Cronómetro y corte automático a los 3 minutos.
  useEffect(() => {
    if (!grabando) return;
    const t = setInterval(() => {
      const s = (Date.now() - inicio.current) / 1000;
      setSegundos(s);
      if (s >= MAX_SEGUNDOS) detener();
    }, 250);
    return () => clearInterval(t);
  }, [grabando]);

  // Si se sale de la ficha grabando, se suelta el micrófono.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function empezar() {
    setError(null);
    const tipo = formatoGrabacion();
    if (!navigator.mediaDevices?.getUserMedia || !tipo) {
      setError('Este navegador no permite grabar audio.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: tipo });
      trozos.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && trozos.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const duracion = (Date.now() - inicio.current) / 1000;
        const blob = new Blob(trozos.current, { type: rec.mimeType || tipo });
        if (duracion < 2) {
          setError('La grabación fue demasiado corta.');
          return;
        }
        subir.mutate({ blob, duracion });
      };
      recorder.current = rec;
      inicio.current = Date.now();
      setSegundos(0);
      rec.start(1000);
      setGrabando(true);
    } catch {
      setError('No se pudo usar el micrófono. Revisa el permiso del navegador.');
    }
  }

  function detener() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    setGrabando(false);
  }

  function registrada() {
    qc.invalidateQueries({ queryKey: ['notas-voz', leadId] });
    qc.invalidateQueries({ queryKey: ['lead', leadId] });
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['seguimientos'] });
  }

  const lista = notas.data ?? [];

  return (
    <div className="card">
      <div className="fila">
        <strong>Notas de voz</strong>
        {puedeEditar && !grabando && (
          <button type="button" className="btn btn-sec" onClick={empezar} disabled={subir.isPending}>
            <Icono nombre="microfono" tam={15} />{subir.isPending ? 'Subiendo…' : 'Grabar nota'}
          </button>
        )}
      </div>
      <p className="meta" style={{ marginTop: 6 }}>
        Después de hablar con el cliente, cuenta en voz alta cómo te fue y qué quedaron. El CRM
        lo transcribe y te propone la actividad y el siguiente seguimiento para que la revises.
      </p>

      {grabando && (
        <div className="voz-grabando">
          <span className="voz-punto" aria-hidden="true" />
          <strong>Grabando {mmss(segundos)}</strong>
          <span className="meta">máx. {mmss(MAX_SEGUNDOS)}</span>
          <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={detener}>
            Detener y enviar
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}

      {lista.map((n) => (
        <div key={n.id} className="voz-nota">
          <div className="fila" style={{ flexWrap: 'wrap' }}>
            <span className="meta">
              {fecha(n.createdAt)}{n.user ? ` · ${n.user.name}` : ''}{n.durationSec ? ` · ${mmss(n.durationSec)}` : ''}
            </span>
            {n.activityId ? (
              <span className="chip chip-verde">Registrada</span>
            ) : enProceso(n) ? (
              <span className="chip chip-gris">{n.status === 'pendiente' ? 'Transcribiendo…' : 'Preparando propuesta…'}</span>
            ) : n.status === 'error' ? (
              <span className="chip chip-rojo">No se pudo transcribir</span>
            ) : (
              <span className="chip">Por revisar</span>
            )}
          </div>
          <audio controls preload="none" src={`/api/v1/leads/notas-voz/${n.id}/audio`} className="voz-audio" />

          {n.error && !enProceso(n) && (
            <p className="error" style={{ marginTop: 4 }}>
              {n.error}{' '}
              {puedeEditar && !n.activityId && (
                <button type="button" className="btn btn-sec" style={{ padding: '4px 10px', minHeight: 0 }} onClick={() => reintentar.mutate(n.id)}>
                  Reintentar
                </button>
              )}
            </p>
          )}

          {n.transcript && (
            <button type="button" className="enlace-btn" onClick={() => setVerTexto(verTexto === n.id ? null : n.id)}>
              {verTexto === n.id ? 'Ocultar transcripción' : 'Ver transcripción'}
            </button>
          )}
          {verTexto === n.id && <p className="voz-transcripcion">{n.transcript}</p>}

          {puedeEditar && !n.activityId && !enProceso(n) && n.transcript && (
            <Revision nota={n} alRegistrar={registrada} />
          )}
        </div>
      ))}
    </div>
  );
}
