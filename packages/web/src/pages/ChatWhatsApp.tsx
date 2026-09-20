/**
 * Conversación de WhatsApp dentro de la ficha del lead.
 *
 * Va aquí y no en una bandeja aparte porque el asesor contesta mirando el proyecto, la
 * unidad y el historial. Lo que la pantalla tiene que dejar claro antes que nada es si la
 * ventana de 24 horas sigue abierta: define si puede escribir lo que quiera o solo una
 * plantilla, y lo segundo se paga.
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Mensaje {
  id: string;
  direction: 'entrante' | 'saliente';
  type: string;
  body: string | null;
  templateName: string | null;
  status: 'pendiente' | 'enviado' | 'entregado' | 'leido' | 'fallido';
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface Respuesta {
  conversacion: {
    id: string;
    waId: string;
    windowExpiresAt: string | null;
    waNumber: { displayNumber: string; active: boolean };
    messages: Mensaje[];
  } | null;
  ventanaAbierta: boolean;
}

interface Plantilla {
  name: string;
  status?: string;
  language?: string;
}

const ACUSE: Record<Mensaje['status'], string> = {
  pendiente: 'enviando…',
  enviado: '✓',
  entregado: '✓✓',
  leido: '✓✓ leído',
  fallido: 'no se envió',
};

export default function ChatWhatsApp({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [variables, setVariables] = useState('');
  const finRef = useRef<HTMLDivElement>(null);

  const chat = useQuery({
    queryKey: ['wa', leadId],
    queryFn: () => api.get<Respuesta>(`/leads/${leadId}/whatsapp`),
    // El mensaje del cliente llega por webhook, no por esta pestaña: sin refresco, el
    // asesor cree que nadie le contestó.
    refetchInterval: 15_000,
  });

  const plantillas = useQuery({
    queryKey: ['wa-templates'],
    queryFn: () => api.get<{ ok: boolean; templates?: Plantilla[]; error?: string }>('/whatsapp/templates'),
    enabled: chat.data?.conversacion != null && !chat.data.ventanaAbierta,
    staleTime: 5 * 60 * 1000,
  });

  const enviar = useMutation({
    mutationFn: (cuerpo: Record<string, unknown>) => api.post(`/leads/${leadId}/whatsapp`, cuerpo),
    onSuccess: () => {
      setTexto(''); setVariables('');
      qc.invalidateQueries({ queryKey: ['wa', leadId] });
      qc.invalidateQueries({ queryKey: ['lead', leadId] });
    },
  });

  const mensajes = chat.data?.conversacion?.messages ?? [];
  useEffect(() => {
    finRef.current?.scrollIntoView({ block: 'nearest' });
  }, [mensajes.length]);

  if (chat.isLoading) return null;

  if (!chat.data?.conversacion) {
    return (
      <div className="card">
        <strong>WhatsApp</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Todavía no hay conversación con este contacto. WhatsApp no permite escribir
          primero: la conversación la abre el cliente, desde un anuncio o desde el número
          publicado.
        </p>
      </div>
    );
  }

  const { conversacion, ventanaAbierta } = chat.data;
  const vence = conversacion.windowExpiresAt ? new Date(conversacion.windowExpiresAt) : null;
  const horas = vence ? Math.max(0, Math.round((vence.getTime() - Date.now()) / 3600_000)) : 0;

  const aprobadas = (plantillas.data?.templates ?? []).filter((p) => p.status === 'APPROVED');
  const elegida = aprobadas.find((p) => p.name === plantilla);

  return (
    <div className="card">
      <div className="fila">
        <strong>WhatsApp</strong>
        <span className={ventanaAbierta ? 'chip' : 'chip chip-alerta'}>
          {ventanaAbierta ? `ventana abierta · ${horas} h` : 'ventana cerrada'}
        </span>
      </div>
      <p className="meta" style={{ marginTop: 4 }}>
        Desde {conversacion.waNumber.displayNumber}
        {!conversacion.waNumber.active && ' · número pausado'}
      </p>

      <div className="chat">
        {mensajes.map((m) => (
          <div key={m.id} className={m.direction === 'entrante' ? 'burbuja entra' : 'burbuja sale'}>
            {m.body ? (
              <span>{m.body}</span>
            ) : (
              <span className="meta">[{m.type}] se ve en el teléfono</span>
            )}
            <div className="meta acuse">
              {new Date(m.sentAt ?? m.createdAt).toLocaleString('es-PE', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}
              {m.direction === 'saliente' && ` · ${ACUSE[m.status]}`}
            </div>
            {m.error && <div className="error">{m.error}</div>}
          </div>
        ))}
        <div ref={finRef} />
      </div>

      {ventanaAbierta ? (
        <form
          onSubmit={(e) => { e.preventDefault(); if (texto.trim()) enviar.mutate({ text: texto.trim() }); }}
        >
          <label htmlFor="wa-texto">Responder</label>
          <textarea
            id="wa-texto"
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escribe tu respuesta"
          />
          <div className="acciones">
            <button type="submit" className="btn" disabled={!texto.trim() || enviar.isPending}>
              {enviar.isPending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </form>
      ) : (
        <div style={{ borderTop: '1px solid var(--borde)', paddingTop: 12, marginTop: 12 }}>
          <p className="meta">
            Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo deja
            escribir con una plantilla aprobada, y esa sí se cobra. Al responder el cliente,
            la ventana se reabre.
          </p>
          {plantillas.data && plantillas.data.ok === false && (
            <p className="error">No se pudieron traer las plantillas: {plantillas.data.error}</p>
          )}
          <label htmlFor="wa-plantilla">Plantilla</label>
          <select id="wa-plantilla" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
            <option value="">Elegir una plantilla</option>
            {aprobadas.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
          {aprobadas.length === 0 && plantillas.data?.ok && (
            <p className="meta">Esta cuenta todavía no tiene plantillas aprobadas por Meta.</p>
          )}
          <label htmlFor="wa-vars">Variables (separadas por coma, en orden)</label>
          <input
            id="wa-vars"
            value={variables}
            onChange={(e) => setVariables(e.target.value)}
            placeholder="Jorge, Edificio Aurora"
          />
          <div className="acciones">
            <button
              type="button"
              className="btn"
              disabled={!plantilla || enviar.isPending}
              onClick={() =>
                enviar.mutate({
                  templateName: plantilla,
                  language: elegida?.language ?? 'es',
                  variables: variables.split(',').map((v) => v.trim()).filter(Boolean),
                })
              }
            >
              {enviar.isPending ? 'Enviando…' : 'Enviar plantilla'}
            </button>
          </div>
        </div>
      )}
      {enviar.isError && <p className="error">{(enviar.error as Error).message}</p>}
    </div>
  );
}
