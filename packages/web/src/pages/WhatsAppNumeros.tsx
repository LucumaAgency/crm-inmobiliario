/**
 * Números de WhatsApp Business conectados, dentro de Ajustes.
 *
 * Desde nov-2026 el camino normal es el botón «Conectar WhatsApp» (alta incrustada de
 * Meta): el cliente conecta su número sin copiar IDs ni tokens, y puede elegir
 * coexistencia (el número sigue en la app del celular). El alta a mano con token queda
 * plegada como opción avanzada. Ver api/src/services/whatsapp-alta.ts.
 */
import { useState } from 'react';
import type React from 'react';
import { useSearchParams } from 'react-router-dom';
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
  origen: string;
  coexistencia: boolean;
  abrirLeads: boolean;
  ownerUserId: string | null;
  owner: { id: string; name: string } | null;
  onboardedAt: string | null;
  syncContactosAt: string | null;
  syncHistorialAt: string | null;
  syncError: string | null;
  historialEstado: string | null;
  historialProgreso: number | null;
}

const ESTADO_HISTORIAL: Record<string, string> = {
  pendiente: 'historial por pedir',
  en_curso: 'historial llegando',
  completo: 'historial completo',
  rechazado: 'historial no compartido',
};

/** Lo que ve el gerente al volver de la página de Meta. Se muestra una vez. */
function RetornoAlta() {
  const [params, setParams] = useSearchParams();
  const wa = params.get('wa');
  if (!wa) return null;
  const cerrar = () => {
    const p = new URLSearchParams(params);
    for (const k of ['wa', 'numero', 'coex', 'avisos', 'detalle']) p.delete(k);
    setParams(p, { replace: true });
  };
  const avisos = (params.get('avisos') ?? '').split(' | ').filter(Boolean);
  return (
    <div
      className="card"
      style={{ marginTop: 10, background: wa === 'ok' ? 'var(--verde-tinte)' : 'var(--rojo-tinte)' }}
    >
      {wa === 'ok' ? (
        <>
          <strong>{params.get('numero')} quedó conectado.</strong>
          <p className="meta" style={{ marginTop: 4 }}>
            {params.get('coex') === '1'
              ? 'Sigue funcionando en la app del celular y sus chats entran al CRM. El CRM ya pidió a Meta los contactos y el historial: llegan en los próximos minutos u horas.'
              : 'El número vive ahora en el CRM. Prueba escribirle desde otro teléfono.'}
          </p>
          {avisos.map((a) => <p key={a} className="error">{a}</p>)}
        </>
      ) : (
        <>
          <strong>No se pudo conectar el número.</strong>
          <p className="meta" style={{ marginTop: 4 }}>{params.get('detalle') || 'Sin detalle.'}</p>
        </>
      )}
      <div className="acciones">
        <button className="btn btn-sec" onClick={cerrar}>Entendido</button>
      </div>
    </div>
  );
}

/** Los números de prueba de Meta son estadounidenses del prefijo ficticio 555. */
function esNumeroDePrueba(numero: string) {
  return /^\+?1\s*555/.test(numero.replace(/[\s().-]/g, '').replace(/^\+?1/, '+1 '));
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
  const alta = useQuery({
    queryKey: ['wa-alta-estado'],
    queryFn: () => api.get<{ disponible: boolean }>('/whatsapp/alta/estado'),
  });
  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; role: string; active: boolean }[]>('/users'),
  });
  const asesores = (usuarios.data ?? []).filter((u) => u.active);
  const [modoAlta, setModoAlta] = useState<'coexistencia' | 'nuevo'>('coexistencia');
  const [duenoAlta, setDuenoAlta] = useState('');
  const [proyectoAlta, setProyectoAlta] = useState('');
  const [abrirLeadsAlta, setAbrirLeadsAlta] = useState(true);
  const [manualAbierto, setManualAbierto] = useState(false);

  const pedirPase = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>('/whatsapp/alta/pase', {
        modo: modoAlta,
        abrirLeads: abrirLeadsAlta,
        ownerUserId: duenoAlta || null,
        projectId: proyectoAlta || null,
      }),
    // La página de Meta vive en el dominio base del CRM (el único autorizado en Meta).
    onSuccess: (r) => { window.location.href = r.url; },
  });
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
        Hay tres formas de trabajar con WhatsApp. Se puede empezar por la primera y pasar a otra
        cuando el equipo quiera.
      </p>
      <RetornoAlta />

      {/*
        Las tres formas se muestran siempre, con la actual marcada. Antes había solo un párrafo
        de advertencia, y la pregunta que llegaba de todos los clientes era la misma: «¿entonces
        tengo que comprar un chip?». La respuesta es «depende de cómo quieras trabajar», y eso
        se entiende mejor como una elección que como un aviso.
      */}
      {(() => {
        /**
         * El número de prueba que Meta da a cada app (+1 555…) no cuenta como «trabajar con
         * un número de la empresa»: solo escribe a cinco destinatarios registrados y nadie
         * del público puede escribirle. Marcarlo como modo 2 hacía creer que el canal ya
         * estaba operando.
         */
        const reales = (numeros.data ?? []).filter((n) => n.active && !esNumeroDePrueba(n.displayNumber));
        const conCoexistencia = reales.some((n) => n.coexistencia);
        const conNumero = reales.some((n) => !n.coexistencia);
        const Modo = ({ actual, titulo, children }: { actual: boolean; titulo: string; children: React.ReactNode }) => (
          <div
            className="card"
            style={{
              marginTop: 8,
              background: actual ? 'var(--superficie-azul)' : 'var(--superficie-2)',
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
            <Modo actual={!conNumero || conCoexistencia} titulo="1 · Cada asesor desde su celular">
              El asesor sigue escribiendo desde WhatsApp Business en su celular. Si conecta su
              número con «Conectar WhatsApp» (coexistencia), sus chats entran a la ficha de cada
              lead, lo que escribe desde el teléfono también, y los leads que le escriben le
              llegan a él. Sin conectar, solo se registra la actividad, no el chat. Mejor un
              número de trabajo por asesor: con coexistencia entran todos los chats 1 a 1 del
              número, también los personales.
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

      {alta.data?.disponible && (
        <div className="card" style={{ marginTop: 14 }}>
          <strong>Conectar WhatsApp</strong>
          <p className="meta" style={{ marginTop: 4 }}>
            Se abre una ventana de Meta donde inicias sesión con Facebook y eliges el número. No
            hace falta copiar IDs ni tokens.
          </p>
          <label htmlFor="alta-modo">Qué número vas a conectar</label>
          <select id="alta-modo" value={modoAlta} onChange={(e) => setModoAlta(e.target.value as 'coexistencia' | 'nuevo')}>
            <option value="coexistencia">El de la app WhatsApp Business de un celular (sigue funcionando ahí)</option>
            <option value="nuevo">Un número nuevo que vivirá solo en el CRM</option>
          </select>
          {modoAlta === 'coexistencia' ? (
            <p className="meta" style={{ marginTop: 6 }}>
              Ten a mano el celular: Meta pide escanear un código desde la app. Se cierran WhatsApp
              Web y escritorio (se pueden volver a vincular; WhatsApp para Windows no es
              compatible), y si el celular no abre WhatsApp en unos 14 días Meta desconecta el
              número. Al terminar, el CRM trae solo los contactos y el historial (hasta 6 meses) de los clientes que ya son leads.
            </p>
          ) : (
            <p className="meta" style={{ marginTop: 6 }}>
              Si ese número está hoy en la app de un celular, deja de funcionar ahí. Para el
              número de un asesor, usa la opción de arriba.
            </p>
          )}
          <div className="rejilla-2">
            <div>
              <label htmlFor="alta-dueno">Asesor dueño del número</label>
              <select id="alta-dueno" value={duenoAlta} onChange={(e) => setDuenoAlta(e.target.value)}>
                <option value="">Ninguno: reparto normal</option>
                {asesores.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="alta-proy">Proyecto por defecto</label>
              <select id="alta-proy" value={proyectoAlta} onChange={(e) => setProyectoAlta(e.target.value)}>
                <option value="">Sin proyecto</option>
                {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <label htmlFor="alta-leads">Chats nuevos de personas que no son leads</label>
          <select
            id="alta-leads"
            value={abrirLeadsAlta ? 'si' : 'no'}
            onChange={(e) => setAbrirLeadsAlta(e.target.value === 'si')}
          >
            <option value="si">Abren un lead (número de ventas)</option>
            <option value="no">No se guardan: solo chats de quien ya es lead (número general)</option>
          </select>
          <p className="meta" style={{ marginTop: 4 }}>
            Elige «No se guardan» si a ese número escriben también clientes actuales, proveedores o
            conocidos. Igual entran como lead los que llegan desde un anuncio de WhatsApp.
          </p>
          {pedirPase.isError && <p className="error">{(pedirPase.error as Error).message}</p>}
          <div className="acciones">
            <button className="btn" onClick={() => pedirPase.mutate()} disabled={pedirPase.isPending}>
              {pedirPase.isPending ? 'Abriendo Meta…' : 'Conectar WhatsApp'}
            </button>
          </div>
        </div>
      )}

      {numeros.data?.length === 0 && <p className="meta">No hay ningún número conectado.</p>}

      {numeros.data?.map((n) => (
        <div key={n.id} className="card" style={{ background: 'var(--superficie-2)', marginTop: 10 }}>
          <div className="fila">
            <span className="nombre">{n.displayNumber}</span>
            {esNumeroDePrueba(n.displayNumber) && (
              <span className="chip chip-gris" title="Número que Meta da a cada app para desarrollar: solo escribe a 5 destinatarios registrados y nadie del público puede escribirle.">
                número de prueba de Meta
              </span>
            )}
            <span className={n.active ? 'chip' : 'chip chip-gris'}>{n.active ? 'activo' : 'pausado'}</span>
            {n.coexistencia && (
              <span className="chip chip-verde" title="Sigue en la app WhatsApp Business del celular y además entra al CRM.">
                también en el celular
              </span>
            )}
            {n.coexistencia && n.historialEstado && (
              <span className={n.historialEstado === 'rechazado' ? 'chip chip-alerta' : 'chip chip-gris'}>
                {ESTADO_HISTORIAL[n.historialEstado] ?? n.historialEstado}
                {n.historialEstado === 'en_curso' && n.historialProgreso != null ? ` ${n.historialProgreso}%` : ''}
              </span>
            )}
          </div>
          <p className="meta">
            Token: {n.tokenHint ?? 'no se pudo leer'} ·{' '}
            {n.lastInboundAt
              ? `último mensaje ${new Date(n.lastInboundAt).toLocaleString('es-PE')}`
              : 'sin mensajes todavía'}
          </p>
          {n.lastError && <p className="error">Último error de Meta: {n.lastError}</p>}
          {n.syncError && <p className="error">Sincronización: {n.syncError}</p>}

          <label>Chats nuevos de personas que no son leads</label>
          <select
            value={n.abrirLeads ? 'si' : 'no'}
            onChange={(e) => actualizar.mutate({ id: n.id, datos: { abrirLeads: e.target.value === 'si' } })}
          >
            <option value="si">Abren un lead</option>
            <option value="no">No se guardan (solo chats de quien ya es lead o viene de un anuncio)</option>
          </select>

          <label>Asesor dueño del número</label>
          <select
            value={n.ownerUserId ?? ''}
            onChange={(e) => actualizar.mutate({ id: n.id, datos: { ownerUserId: e.target.value || null } })}
          >
            <option value="">Ninguno: los leads se reparten</option>
            {asesores.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>

          <label>Proyecto por defecto</label>
          <select
            value={n.projectId ?? ''}
            onChange={(e) => actualizar.mutate({ id: n.id, datos: { projectId: e.target.value || null } })}
          >
            <option value="">Sin proyecto</option>
            {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          {n.origen === 'manual' && (
            <>
              <label htmlFor={`token-${n.id}`}>Reemplazar el token</label>
              <input
                id={`token-${n.id}`}
                type="password"
                placeholder="Pegar un token nuevo"
                value={tokenNuevo[n.id] ?? ''}
                onChange={(e) => setTokenNuevo((t) => ({ ...t, [n.id]: e.target.value }))}
              />
            </>
          )}

          <div className="acciones" style={{ marginTop: 12 }}>
            {/* Guardar explícito: con `onBlur` la prueba se adelantaba al guardado. */}
            {n.origen === 'manual' && <button
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
            </button>}
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
                const extra = n.coexistencia
                  ? ' Esto solo lo quita del CRM: para cortar el acceso de Meta, en la app ve a Ajustes → Cuenta → Plataforma empresarial → Desconectar.'
                  : '';
                if (confirm(`¿Desconectar ${n.displayNumber}? El historial de chats se queda.${extra}`)) {
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

      {alta.data?.disponible && !manualAbierto ? (
        <p className="meta" style={{ marginTop: 14 }}>
          <button type="button" className="btn btn-sec" onClick={() => setManualAbierto(true)}>
            Conectar a mano con token (avanzado)
          </button>
        </p>
      ) : (
      <form
        style={{ marginTop: 14, borderTop: '1px solid var(--borde)', paddingTop: 12 }}
        onSubmit={(e) => { e.preventDefault(); conectar.mutate(); }}
      >
        <p className="meta">
          <strong>Alta a mano:</strong> el número pasa a la API y deja de funcionar en la app del
          celular. Nunca el número de un asesor (para eso, «Conectar WhatsApp» con coexistencia).
        </p>
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
      )}
    </div>
  );
}
