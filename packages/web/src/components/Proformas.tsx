import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { fecha, precio } from '../lib/format.js';
import Icono from './Icono.js';

interface Item { unitId: string; kind: string; code: string; price: number; areaM2: number | null }
interface Proforma {
  id: string; number: string; createdAt: string; validUntil: string; currency: string;
  listTotal: string; discountPct: string; discountAmount: string; finalTotal: string;
  items: Item[]; emailSentAt: string | null; emailTo: string | null; whatsappSentAt: string | null;
  createdBy: { id: string; name: string } | null;
}
interface Unidad { id: string; code: string; kind: string; status: string; price: string | null; currency: string; areaM2: string | null; bedrooms: number | null; typologyRef: { name: string } | null }

const KIND: Record<string, string> = { departamento: 'Departamentos', oficina: 'Oficinas', lote: 'Lotes', estacionamiento: 'Estacionamientos', deposito: 'Depósitos', otro: 'Otros' };
const ORDEN = ['departamento', 'oficina', 'lote', 'otro', 'estacionamiento', 'deposito'];

/**
 * Proformas del lead: lista de las emitidas y el formulario para emitir una nueva.
 *
 * El asesor elige unidades disponibles del proyecto (las de interés vienen marcadas), aplica
 * un descuento dentro de su tope y emite. El PDF queda guardado y se envía por correo o por
 * WhatsApp desde aquí mismo; cada envío queda en el historial del lead.
 */
export default function Proformas({ leadId, projectId, unitIdsInteres, tieneCorreo, puedeEditar }: {
  leadId: string;
  projectId: string | null;
  unitIdsInteres: string[];
  tieneCorreo: boolean;
  puedeEditar: boolean;
}) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState(false);
  const [unitIds, setUnitIds] = useState<string[]>(unitIdsInteres);
  // Dos campos ligados: escribir el % recalcula el monto y al revés. Manda el último tocado.
  const [pct, setPct] = useState('');
  const [monto, setMonto] = useState('');
  const [ultimo, setUltimo] = useState<'pct' | 'monto'>('pct');
  const [vence, setVence] = useState('');
  const [correoA, setCorreoA] = useState<{ id: string; to: string } | null>(null);

  const lista = useQuery({
    queryKey: ['proformas', leadId],
    queryFn: () => api.get<{ proformas: Proforma[]; descuentoMaximoPct: number | null }>(`/leads/${leadId}/proformas`),
  });
  const unidades = useQuery({
    queryKey: ['units', projectId],
    queryFn: () => api.get<Unidad[]>(`/projects/${projectId}/units`),
    enabled: Boolean(projectId) && abierto,
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['proformas', leadId] });
    qc.invalidateQueries({ queryKey: ['lead', leadId] });
  };
  const emitir = useMutation({
    mutationFn: () =>
      api.post<Proforma>(`/leads/${leadId}/proformas`, {
        unitIds,
        ...(montoDesc > 0 ? (ultimo === 'pct' ? { discountPct: numero(pct) } : { discountAmount: numero(monto) }) : {}),
        ...(vence ? { validUntil: vence } : {}),
      }),
    onSuccess: (p) => {
      setAbierto(false); setPct(''); setMonto(''); setVence('');
      refrescar();
      window.open(`/api/v1/leads/proformas/${p.id}/pdf`, '_blank');
    },
  });
  const email = useMutation({
    mutationFn: (v: { id: string; to?: string }) => api.post(`/leads/proformas/${v.id}/email`, v.to ? { to: v.to } : {}),
    onSuccess: () => { setCorreoA(null); refrescar(); },
  });
  const whatsapp = useMutation({
    mutationFn: (id: string) => api.post(`/leads/proformas/${id}/whatsapp`),
    onSuccess: () => { refrescar(); qc.invalidateQueries({ queryKey: ['wa', leadId] }); },
  });

  const grupos = useMemo(() => {
    const m = new Map<string, Unidad[]>();
    for (const u of unidades.data ?? []) {
      if (!m.has(u.kind)) m.set(u.kind, []);
      m.get(u.kind)!.push(u);
    }
    return [...m.entries()].sort((a, b) => ORDEN.indexOf(a[0]) - ORDEN.indexOf(b[0]));
  }, [unidades.data]);

  const elegidas = (unidades.data ?? []).filter((u) => unitIds.includes(u.id));
  const moneda = elegidas[0]?.currency ?? 'PEN';
  const total = elegidas.reduce((s, u) => s + Number(u.price ?? 0), 0);
  const montoDesc = ultimo === 'pct' ? (total * numero(pct)) / 100 : numero(monto);
  const pctDesc = total > 0 ? (montoDesc / total) * 100 : 0;
  const hoy = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const tope = lista.data?.descuentoMaximoPct ?? null;
  const pasaTope = tope != null && pctDesc > tope + 0.005;
  const sinPrecio = elegidas.some((u) => u.price == null);

  return (
    <div className="card">
      <div className="fila">
        <strong>Proformas</strong>
        {puedeEditar && !abierto && (
          <button
            type="button"
            className="btn"
            style={{ padding: '6px 12px', fontSize: 13 }}
            disabled={!projectId}
            title={projectId ? undefined : 'Asigna un proyecto al lead primero'}
            onClick={() => { setUnitIds(unitIdsInteres); setAbierto(true); }}
          >
            <Icono nombre="mas" tam={14} />Nueva proforma
          </button>
        )}
      </div>

      {!projectId && <p className="meta" style={{ marginTop: 6 }}>Para cotizar, primero asigna un proyecto en Interés.</p>}

      {abierto && (
        <form
          style={{ marginTop: 10, borderTop: '1px solid var(--borde)', paddingTop: 10 }}
          onSubmit={(e) => { e.preventDefault(); if (unitIds.length && !pasaTope && !sinPrecio) emitir.mutate(); }}
        >
          {unidades.isLoading && <p className="meta">Cargando unidades…</p>}
          {grupos.map(([kind, us]) => (
            <div key={kind} className="grupo-unidades">
              <div className="meta grupo-titulo">{KIND[kind] ?? kind}</div>
              <div className="casillas casillas-unidades">
                {us.map((u) => {
                  const disponible = u.status === 'disponible';
                  const marcada = unitIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`casilla casilla-unidad ${marcada ? 'marcada' : ''} ${!disponible ? 'agotada' : ''}`}
                      title={!disponible ? `Unidad ${u.status.replace('_', ' ')}: no se puede cotizar` : undefined}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={!disponible}
                        onChange={() => setUnitIds(marcada ? unitIds.filter((x) => x !== u.id) : [...unitIds, u.id])}
                      />
                      <span>
                        <strong>{u.code}</strong>
                        <span className="meta">{u.price ? precio(u.price, u.currency) : 'sin precio'}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="rejilla-2" style={{ marginTop: 10 }}>
            <div>
              <label>Descuento {tope != null && <span className="meta">(tu máximo: {tope}%)</span>}</label>
              <div className="descuento-doble">
                <span className="porcentaje">
                  <input
                    inputMode="decimal"
                    value={pct}
                    placeholder="0"
                    aria-label="Descuento en porcentaje"
                    onChange={(e) => {
                      setPct(e.target.value); setUltimo('pct');
                      const n = numero(e.target.value);
                      setMonto(n > 0 && total > 0 ? String(Math.round((total * n) / 100)) : '');
                    }}
                    style={{ width: 80, textAlign: 'right' }}
                  />
                  <span className="meta">%</span>
                </span>
                <span className="porcentaje">
                  <span className="meta">{moneda === 'USD' ? 'US$' : 'S/'}</span>
                  <input
                    inputMode="decimal"
                    value={monto}
                    placeholder="0"
                    aria-label="Descuento en monto"
                    onChange={(e) => {
                      setMonto(e.target.value); setUltimo('monto');
                      const n = numero(e.target.value);
                      setPct(n > 0 && total > 0 ? String(Math.round((n / total) * 10000) / 100) : '');
                    }}
                    style={{ width: 120, textAlign: 'right' }}
                  />
                </span>
              </div>
              <label htmlFor="pf-vence" style={{ marginTop: 10 }}>Válida hasta <span className="meta">(vacío = {lista.data ? 'según ajustes' : '3 días'})</span></label>
              <input id="pf-vence" type="date" min={hoy} value={vence} onChange={(e) => setVence(e.target.value)} style={{ width: 170 }} />
            </div>
            <div>
              <label>Resumen</label>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
                <div className="fila"><span className="meta">Precio de lista</span><span>{precio(total, moneda)}</span></div>
                {montoDesc > 0 && <div className="fila"><span className="meta">Descuento ({pctDesc.toFixed(2)}%)</span><span>- {precio(montoDesc, moneda)}</span></div>}
                <div className="fila"><strong>Precio final</strong><strong>{precio(total - montoDesc, moneda)}</strong></div>
              </div>
            </div>
          </div>
          {pasaTope && <p className="error">El descuento supera tu máximo de {tope}%.</p>}
          {sinPrecio && <p className="error">Alguna unidad elegida no tiene precio de lista.</p>}
          {emitir.isError && <p className="error">{(emitir.error as ApiError).message}</p>}
          <div className="acciones">
            <button className="btn" disabled={!unitIds.length || pasaTope || sinPrecio || emitir.isPending}>
              {emitir.isPending ? 'Generando…' : 'Emitir proforma'}
            </button>
            <button type="button" className="btn btn-sec" onClick={() => { setAbierto(false); emitir.reset(); }}>Cancelar</button>
          </div>
        </form>
      )}

      {lista.data && lista.data.proformas.length === 0 && !abierto && projectId && (
        <p className="meta" style={{ marginTop: 6 }}>Sin proformas todavía.</p>
      )}

      {lista.data && lista.data.proformas.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {lista.data.proformas.map((p) => {
            const vencida = new Date(p.validUntil).getTime() < Date.now();
            return (
              <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--borde-suave)' }}>
                <div className="fila">
                  <span>
                    <a href={`/api/v1/leads/proformas/${p.id}/pdf`} target="_blank" rel="noreferrer" className="nombre" style={{ fontSize: 14 }}>
                      Proforma {p.number}
                    </a>
                    <span className="meta"> · {p.items.map((i) => i.code).join(' + ')}</span>
                  </span>
                  <strong>{precio(p.finalTotal, p.currency)}</strong>
                </div>
                <div className="meta" style={{ marginTop: 3 }}>
                  {fecha(p.createdAt)} · {p.createdBy?.name ?? ''}
                  {Number(p.discountPct) > 0 && ` · desc. ${Number(p.discountPct)}%`}
                  {' · '}
                  {vencida ? <span className="chip chip-gris">Vencida</span> : <span className="chip chip-verde">Válida hasta {fecha(p.validUntil)}</span>}
                </div>
                <div className="meta" style={{ marginTop: 3 }}>
                  {p.emailSentAt && <span className="chip chip-gris" style={{ marginRight: 4 }}>Correo {fecha(p.emailSentAt)}</span>}
                  {p.whatsappSentAt && <span className="chip chip-gris">WhatsApp {fecha(p.whatsappSentAt)}</span>}
                </div>
                {puedeEditar && (
                  <div className="acciones" style={{ margin: '8px 0 0' }}>
                    <a className="btn btn-sec" style={{ padding: '5px 10px', fontSize: 12 }} href={`/api/v1/leads/proformas/${p.id}/pdf?descargar=1`}>
                      <Icono nombre="descargar" tam={13} />PDF
                    </a>
                    <button
                      type="button"
                      className="btn btn-sec"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      disabled={email.isPending}
                      onClick={() => (tieneCorreo ? email.mutate({ id: p.id }) : setCorreoA({ id: p.id, to: '' }))}
                    >
                      {email.isPending && email.variables?.id === p.id ? 'Enviando…' : 'Enviar por correo'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-wa"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      disabled={whatsapp.isPending}
                      onClick={() => whatsapp.mutate(p.id)}
                    >
                      {whatsapp.isPending && whatsapp.variables === p.id ? 'Enviando…' : 'Enviar por WhatsApp'}
                    </button>
                  </div>
                )}
                {correoA?.id === p.id && (
                  <form className="acciones" style={{ margin: '8px 0 0' }} onSubmit={(e) => { e.preventDefault(); if (correoA.to) email.mutate({ id: p.id, to: correoA.to }); }}>
                    <input type="email" placeholder="correo del cliente" value={correoA.to} onChange={(e) => setCorreoA({ id: p.id, to: e.target.value })} style={{ flex: 1, minWidth: 180, margin: 0 }} autoFocus />
                    <button className="btn" style={{ padding: '6px 12px', fontSize: 13 }} disabled={!correoA.to || email.isPending}>Enviar</button>
                    <button type="button" className="btn btn-sec" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => setCorreoA(null)}>Cancelar</button>
                  </form>
                )}
              </div>
            );
          })}
          {(email.isError || whatsapp.isError) && (
            <p className="error">{((email.error ?? whatsapp.error) as ApiError).message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** "10,000" → 10000 · "3,5" → 3.5 · basura → 0. */
function numero(t: string) {
  const limpio = t.trim();
  if (!limpio) return 0;
  // Coma como decimal solo si hay una y no hay punto; si hay varias comas son miles.
  const sinMiles = limpio.replace(/\s/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const n = Number(sinMiles.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
