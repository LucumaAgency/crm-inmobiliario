/**
 * Números de WhatsApp Business conectados, dentro de Ajustes.
 *
 * El aviso de arriba no es relleno: migrar un número a la Cloud API lo saca de la app de
 * WhatsApp del teléfono, y es el error que más caro sale en este canal porque no tiene
 * vuelta atrás inmediata.
 */
import { useState } from 'react';
import type React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Numero {
  id: string;
  phoneNumberId: string;
  wabaId: string;
  displayNumber: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  active: boolean;
  lastInboundAt: string | null;
  lastError: string | null;
  tokenHint: string | null;
}

export default function WhatsAppNumeros() {
  const qc = useQueryClient();
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [displayNumber, setDisplayNumber] = useState('');
  const [token, setToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [plantillas, setPlantillas] = useState<{ id: string; texto: string } | null>(null);
  const [tokenNuevo, setTokenNuevo] = useState<Record<string, string>>({});

  const numeros = useQuery({ queryKey: ['wa-numbers'], queryFn: () => api.get<Numero[]>('/whatsapp/numbers') });
  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });

  const conectar = useMutation({
    mutationFn: () =>
      api.post('/whatsapp/numbers', {
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim(),
        displayNumber: displayNumber.trim(),
        accessToken: token.trim(),
        projectId: projectId || null,
      }),
    onSuccess: () => {
      setPhoneNumberId(''); setWabaId(''); setDisplayNumber(''); setToken(''); setProjectId('');
      qc.invalidateQueries({ queryKey: ['wa-numbers'] });
    },
  });

  const actualizar = useMutation({
    mutationFn: (v: { id: string; datos: Record<string, unknown> }) =>
      api.patch(`/whatsapp/numbers/${v.id}`, v.datos),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-numbers'] }),
  });

  const desconectar = useMutation({
    mutationFn: (id: string) => api.del(`/whatsapp/numbers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wa-numbers'] }),
  });

  const probar = useMutation({
    mutationFn: (id: string) =>
      api.get<{ ok: boolean; error?: string; templates?: { name: string; status?: string }[] }>(
        `/whatsapp/numbers/${id}/templates`
      ),
    onSuccess: (res, id) => {
      setPlantillas({
        id,
        texto: res.ok
          ? `Conexión correcta. ${res.templates?.length ?? 0} plantillas, ${
              res.templates?.filter((t) => t.status === 'APPROVED').length ?? 0
            } aprobadas.`
          : `No se pudo conectar: ${res.error}`,
      });
      qc.invalidateQueries({ queryKey: ['wa-numbers'] });
    },
  });

  return (
    <div className="card">
      <strong>WhatsApp</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Un número de WhatsApp vive en la app del celular <strong>o</strong> en el CRM, nunca en
        los dos. Es una regla de Meta, igual para cualquier CRM. Por eso hay tres formas de
        trabajar, y se puede empezar por la primera y pasar a la segunda cuando el equipo quiera.
      </p>

      {/*
        Las tres formas se muestran siempre, con la actual marcada. Antes había solo un párrafo
        de advertencia, y la pregunta que llegaba de todos los clientes era la misma: «¿entonces
        tengo que comprar un chip?». La respuesta es «depende de cómo quieras trabajar», y eso
        se entiende mejor como una elección que como un aviso.
      */}
      {(() => {
        const conNumero = (numeros.data?.length ?? 0) > 0;
        const Modo = ({ actual, titulo, children }: { actual: boolean; titulo: string; children: React.ReactNode }) => (
          <div
            className="card"
            style={{
              marginTop: 8,
              background: actual ? '#f4f7fd' : '#fafbfc',
              borderColor: actual ? 'var(--acento, #174FCA)' : undefined,
            }}
          >
            <div className="fila">
              <strong>{titulo}</strong>
              {actual && <span className="chip">así trabajas hoy</span>}
            </div>
            <p className="meta" style={{ marginTop: 4 }}>{children}</p>
          </div>
        );
        return (
          <>
            <Modo actual={!conNumero} titulo="1 · Cada asesor desde su celular">
              El CRM capta los leads por web y Facebook, y el asesor los escribe desde su propio
              WhatsApp con el botón de la ficha. Lo que se registra es la actividad, no el chat:
              la conversación se queda en el celular del asesor. No hace falta conectar nada.
            </Modo>
            <Modo actual={conNumero} titulo="2 · Un número de la empresa dentro del CRM">
              Un número comercial (en los anuncios, la web y el letrero) cuyos chats entran como
              leads y se reparten entre asesores. Queda registro de todo y el número no se va
              con nadie. Los asesores pueden seguir usando su WhatsApp personal para lo demás.
              Requiere un <strong>número que no esté en ningún celular</strong>: uno nuevo, o el
              corporativo actual aceptando que deja de verse en la app y que el historial no se
              traslada.
            </Modo>
            <Modo actual={false} titulo="3 · Todo el WhatsApp de la empresa desde el CRM">
              Igual que la 2, pero el equipo deja la app por completo y atiende solo desde aquí.
              Es a donde llegan las empresas que operan el CRM en serio; conviene pasar primero
              por la 2 unos meses.
            </Modo>
          </>
        );
      })()}

      <p className="meta" style={{ marginTop: 10 }}>
        <strong>Antes de conectar un número:</strong> al pasarlo a la API deja de funcionar en la
        app del celular y no hay vuelta atrás inmediata. Nunca el número de un asesor. Si el
        equipo atiende hoy desde sus celulares, acuerden quién escribe por dónde para no
        contactar al mismo cliente dos veces.
      </p>

      {numeros.data?.length === 0 && <p className="meta">No hay ningún número conectado.</p>}

      {numeros.data?.map((n) => (
        <div key={n.id} className="card" style={{ background: '#fafbfc', marginTop: 10 }}>
          <div className="fila">
            <span className="nombre">{n.displayNumber}</span>
            <span className={n.active ? 'chip' : 'chip chip-gris'}>{n.active ? 'activo' : 'pausado'}</span>
          </div>
          <p className="meta">
            Token: {n.tokenHint ?? 'no se pudo leer'} ·{' '}
            {n.lastInboundAt
              ? `último mensaje ${new Date(n.lastInboundAt).toLocaleString('es-PE')}`
              : 'sin mensajes todavía'}
          </p>
          {n.lastError && <p className="error">Último error de Meta: {n.lastError}</p>}

          <label>Proyecto por defecto</label>
          <select
            value={n.projectId ?? ''}
            onChange={(e) => actualizar.mutate({ id: n.id, datos: { projectId: e.target.value || null } })}
          >
            <option value="">Sin proyecto</option>
            {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <label htmlFor={`token-${n.id}`}>Reemplazar el token</label>
          <input
            id={`token-${n.id}`}
            type="password"
            placeholder="Pegar un token nuevo"
            value={tokenNuevo[n.id] ?? ''}
            onChange={(e) => setTokenNuevo((t) => ({ ...t, [n.id]: e.target.value }))}
          />

          <div className="acciones" style={{ marginTop: 12 }}>
            {/* Guardar explícito: con `onBlur` la prueba se adelantaba al guardado. */}
            <button
              className="btn btn-sec"
              disabled={!(tokenNuevo[n.id] ?? '').trim() || actualizar.isPending}
              onClick={() =>
                actualizar.mutate(
                  { id: n.id, datos: { accessToken: (tokenNuevo[n.id] ?? '').trim() } },
                  {
                    onSuccess: () => {
                      setTokenNuevo((t) => ({ ...t, [n.id]: '' }));
                      probar.mutate(n.id);
                    },
                  }
                )
              }
            >
              {actualizar.isPending ? 'Guardando…' : 'Guardar token y probar'}
            </button>
            <button
              className="btn btn-sec"
              onClick={() => probar.mutate(n.id)}
              disabled={probar.isPending || actualizar.isPending}
            >
              {probar.isPending ? 'Probando…' : 'Probar conexión'}
            </button>
            <button
              className="btn btn-sec"
              onClick={() => actualizar.mutate({ id: n.id, datos: { active: !n.active } })}
            >
              {n.active ? 'Pausar' : 'Reanudar'}
            </button>
            <button
              className="btn btn-sec"
              onClick={() => {
                if (confirm(`¿Desconectar ${n.displayNumber}? El historial de chats se queda.`)) {
                  desconectar.mutate(n.id);
                }
              }}
            >
              Desconectar
            </button>
          </div>
          {plantillas?.id === n.id && <p className="meta" style={{ marginTop: 8 }}>{plantillas.texto}</p>}
        </div>
      ))}

      <form
        style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
        onSubmit={(e) => { e.preventDefault(); conectar.mutate(); }}
      >
        <div className="rejilla-2">
          <div>
            <label htmlFor="w-pnid">ID del número (phone number ID)</label>
            <input id="w-pnid" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
          </div>
          <div>
            <label htmlFor="w-waba">ID de la cuenta (WABA ID)</label>
            <input id="w-waba" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
          </div>
        </div>
        <label htmlFor="w-num">Número como lo ve el cliente</label>
        <input id="w-num" value={displayNumber} onChange={(e) => setDisplayNumber(e.target.value)} placeholder="+51 999 888 777" />
        <label htmlFor="w-token">Token de acceso</label>
        <input id="w-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />
        <label htmlFor="w-proy">Proyecto por defecto</label>
        <select id="w-proy" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Sin proyecto</option>
          {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {conectar.isError && <p className="error">{(conectar.error as Error).message}</p>}
        <div className="acciones">
          <button
            type="submit"
            className="btn"
            disabled={!phoneNumberId.trim() || !wabaId.trim() || !displayNumber.trim() || token.trim().length < 20 || conectar.isPending}
          >
            {conectar.isPending ? 'Conectando…' : 'Conectar número'}
          </button>
        </div>
      </form>
    </div>
  );
}
