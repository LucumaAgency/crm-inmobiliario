/**
 * Números de WhatsApp Business conectados, dentro de Ajustes.
 *
 * El aviso de arriba no es relleno: migrar un número a la Cloud API lo saca de la app de
 * WhatsApp del teléfono, y es el error que más caro sale en este canal porque no tiene
 * vuelta atrás inmediata.
 */
import { useState } from 'react';
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
        Los chats que abre el cliente entran como leads, con la campaña del anuncio si vino
        de un Click-to-WhatsApp, y el asesor responde desde la ficha.
      </p>
      <p className="meta">
        <strong>Antes de conectar un número:</strong> al pasarlo a la API deja de funcionar
        en la app de WhatsApp del celular. Tiene que ser un número comercial de la empresa,
        nunca el de un asesor. Si el equipo atiende hoy desde sus celulares, esos chats
        quedan fuera del CRM y hay que acordar quién escribe por dónde para no contactar al
        mismo cliente dos veces.
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
