import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { precio } from '../lib/format.js';
import Icono from '../components/Icono.js';

interface Paquete {
  id: string;
  code: string;
  price: string | null;
  currency: string;
  status: string;
  extra: { orden?: number; etiqueta?: string; cobro?: string | null; desde?: boolean; destacado?: boolean; paraQuien?: string | null; bloques?: { grupo?: string; items?: string[]; mas?: string }[] } | null;
}

/**
 * Paquetes de un servicio (vertical agencia).
 *
 * Es la misma tabla `units` que en inmobiliaria guarda departamentos: aquí `code` es el nombre
 * del paquete (Base, Crecimiento, Premium), `price` el precio y `extra` lo demás (cobro «/ mes»,
 * «desde», para quién, qué incluye). Las propuestas eligen paquetes igual que las proformas
 * eligen unidades.
 */
export default function PaquetesServicio({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const paquetes = useQuery({ queryKey: ['units', projectId], queryFn: () => api.get<Paquete[]>(`/projects/${projectId}/units`) });
  const refrescar = () => qc.invalidateQueries({ queryKey: ['units', projectId] });

  const [abierto, setAbierto] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [precioN, setPrecioN] = useState('');
  const [cobro, setCobro] = useState('/ mes');
  const [desde, setDesde] = useState(false);
  const [paraQuien, setParaQuien] = useState('');

  const crear = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/units`, {
        code: nombre.trim(),
        kind: 'otro',
        status: 'disponible',
        price: precioN.trim() ? Number(precioN.replace(/\./g, '').replace(',', '.')) : undefined,
        currency: 'PEN',
        extra: { cobro: cobro.trim() || null, desde, paraQuien: paraQuien.trim() || null, orden: (paquetes.data?.length ?? 0) + 1 },
      }),
    onSuccess: () => { setNombre(''); setPrecioN(''); setParaQuien(''); setDesde(false); refrescar(); },
  });
  const cambiar = useMutation({
    mutationFn: (v: { id: string; datos: Record<string, unknown> }) => api.patch(`/units/${v.id}`, v.datos),
    onSuccess: refrescar,
  });

  const lista = (paquetes.data ?? []).slice().sort((a, b) => (a.extra?.orden ?? 99) - (b.extra?.orden ?? 99) || a.code.localeCompare(b.code));

  return (
    <>
      <div className="card">
        <strong>Paquetes</strong>
        <p className="meta" style={{ marginTop: 4 }}>
          Lo que se cotiza de este servicio. El precio es el que sale en la propuesta; «desde»
          indica que se ajusta en la reunión. Marca uno como recomendado.
        </p>
        {paquetes.data?.length === 0 && <div className="vacio">Sin paquetes. Crea el primero abajo.</div>}
        {lista.length > 0 && (
          <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
            <thead><tr><th>Paquete</th><th>Precio</th><th>Cobro</th><th>Recomendado</th><th>Para quién</th><th></th></tr></thead>
            <tbody>
              {lista.map((p) => (
                <>
                  <tr key={p.id}>
                    <td className="t-titulo">{p.extra?.etiqueta ? <span className="meta">{p.extra.etiqueta} · </span> : null}{p.code}</td>
                    <td data-label="Precio">
                      <input
                        inputMode="decimal"
                        defaultValue={p.price ? String(Number(p.price)) : ''}
                        placeholder="a medida"
                        style={{ width: 100, margin: 0, padding: '5px 7px' }}
                        onBlur={(e) => {
                          const t = e.target.value.trim();
                          const n = t ? Number(t.replace(/\./g, '').replace(',', '.')) : null;
                          if ((n ?? null) !== (p.price ? Number(p.price) : null)) cambiar.mutate({ id: p.id, datos: { price: n } });
                        }}
                      />
                      {p.extra?.desde && <span className="meta"> desde</span>}
                    </td>
                    <td data-label="Cobro">
                      <input defaultValue={p.extra?.cobro ?? ''} placeholder="/ mes" style={{ width: 110, margin: 0, padding: '5px 7px' }}
                        onBlur={(e) => { if ((e.target.value.trim() || null) !== (p.extra?.cobro ?? null)) cambiar.mutate({ id: p.id, datos: { extra: { cobro: e.target.value.trim() || null } } }); }} />
                    </td>
                    <td data-label="Recomendado">
                      <input type="checkbox" checked={p.extra?.destacado ?? false} onChange={(e) => cambiar.mutate({ id: p.id, datos: { extra: { destacado: e.target.checked } } })} />
                    </td>
                    <td data-label="Para quién" className="ancho"><span className="meta">{p.extra?.paraQuien ?? '—'}</span></td>
                    <td className="accion">
                      {(p.extra?.bloques?.length ?? 0) > 0 && (
                        <button type="button" className="btn btn-sec" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                          {abierto === p.id ? 'Ocultar' : 'Qué incluye'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {abierto === p.id && (
                    <tr key={`${p.id}-inc`}>
                      <td colSpan={6} style={{ background: 'var(--fondo)' }}>
                        {p.extra?.bloques?.map((b, i) => (
                          <div key={i} style={{ marginBottom: 6 }}>
                            {b.mas && <div className="meta"><em>{b.mas}</em></div>}
                            {b.grupo && <strong style={{ fontSize: 12.5 }}>{b.grupo}</strong>}
                            {b.items && <ul style={{ margin: '2px 0 0 18px', fontSize: 13 }}>{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
        {cambiar.isError && <p className="error">{(cambiar.error as Error).message}</p>}
      </div>

      <div className="card">
        <strong>Nuevo paquete</strong>
        <form onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) crear.mutate(); }}>
          <div className="rejilla-2">
            <div><label htmlFor="pq-nombre">Nombre *</label><input id="pq-nombre" value={nombre} placeholder="Crecimiento" onChange={(e) => setNombre(e.target.value)} /></div>
            <div><label htmlFor="pq-precio">Precio (S/)</label><input id="pq-precio" inputMode="decimal" value={precioN} placeholder="1200" onChange={(e) => setPrecioN(e.target.value)} /></div>
          </div>
          <div className="rejilla-2">
            <div><label htmlFor="pq-cobro">Cobro</label><input id="pq-cobro" value={cobro} placeholder="/ mes · proyecto · por web" onChange={(e) => setCobro(e.target.value)} /></div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
              <label className="casilla" style={{ margin: 0 }}><input type="checkbox" checked={desde} onChange={(e) => setDesde(e.target.checked)} /><span><strong>Precio «desde»</strong><span className="meta">se ajusta en la reunión</span></span></label>
            </div>
          </div>
          <label htmlFor="pq-para">Para quién</label>
          <input id="pq-para" value={paraQuien} placeholder="PYME que ya compite en su rubro y necesita ganar terreno mes a mes." onChange={(e) => setParaQuien(e.target.value)} />
          {crear.isError && <p className="error">{(crear.error as Error).message}</p>}
          <div className="acciones">
            <button type="submit" className="btn" disabled={!nombre.trim() || crear.isPending}><Icono nombre="mas" tam={14} />{crear.isPending ? 'Guardando…' : 'Añadir paquete'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
