import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';

interface Etapa {
  id: string;
  name: string;
  color: string | null;
  isWon: boolean;
  isLost: boolean;
  position: number;
  _count: { leads: number };
}

const COLOR_NUEVA = '#174FCA';

/**
 * Etapas del embudo de la organización. La primera recibe los leads nuevos; ganada y
 * perdida alimentan los reportes.
 */
export default function EtapasEditor() {
  const qc = useQueryClient();
  const [nueva, setNueva] = useState('');
  const [borrando, setBorrando] = useState<Etapa | null>(null);
  const [destino, setDestino] = useState('');
  const [error, setError] = useState<string | null>(null);

  const etapas = useQuery({ queryKey: ['stages'], queryFn: () => api.get<Etapa[]>('/stages') });
  const lista = etapas.data ?? [];

  // Todo cambio de etapa se refleja en los leads y los reportes que ya estén en caché.
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['stages'] });
    qc.invalidateQueries({ queryKey: ['leads'] });
    qc.invalidateQueries({ queryKey: ['reportes'] });
  };
  const alFallar = (e: Error) => setError(e.message);

  const crear = useMutation({
    mutationFn: () => api.post('/stages', { name: nueva.trim(), color: COLOR_NUEVA }),
    onSuccess: () => {
      setNueva('');
      setError(null);
      refrescar();
    },
    onError: alFallar,
  });
  const cambiar = useMutation({
    mutationFn: (v: { id: string } & Partial<Pick<Etapa, 'name' | 'color' | 'isWon' | 'isLost'>>) => {
      const { id, ...datos } = v;
      return api.patch(`/stages/${id}`, datos);
    },
    onSuccess: () => {
      setError(null);
      refrescar();
    },
    onError: alFallar,
  });
  const ordenar = useMutation({
    mutationFn: (ids: string[]) => api.put('/stages/order', { ids }),
    onSuccess: refrescar,
    onError: alFallar,
  });
  const borrar = useMutation({
    mutationFn: (v: { id: string; moverA?: string }) =>
      api.del(`/stages/${v.id}${v.moverA ? `?moverA=${encodeURIComponent(v.moverA)}` : ''}`),
    onSuccess: () => {
      setBorrando(null);
      setDestino('');
      setError(null);
      refrescar();
    },
    onError: alFallar,
  });

  function mover(i: number, delta: number) {
    const ids = lista.map((e) => e.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    ordenar.mutate(ids);
  }

  function pedirBorrado(e: Etapa) {
    setError(null);
    if (e._count.leads === 0) {
      if (confirm(`¿Eliminar la etapa «${e.name}»?`)) borrar.mutate({ id: e.id });
      return;
    }
    setBorrando(e);
    setDestino(lista.find((x) => x.id !== e.id)?.id ?? '');
  }

  return (
    <div className="card">
      <strong>Etapas del embudo</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        El orden es el recorrido del lead. <strong>La primera etapa recibe los leads nuevos.</strong>{' '}
        Marca como <em>ganada</em> la que cuenta como venta y como <em>perdida</em> la de descarte:
        los reportes se calculan con esas marcas.
      </p>

      <div className="tabla-scroll" style={{ marginTop: 12 }}>
        <table className="tabla">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Orden</th>
              <th style={{ width: 54 }}>Color</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th style={{ textAlign: 'right' }}>Leads</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lista.map((e, i) => (
              <tr key={e.id}>
                <td>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      type="button"
                      className="icono-btn"
                      style={{ width: 26, height: 26 }}
                      aria-label={`Subir ${e.name}`}
                      disabled={i === 0 || ordenar.isPending}
                      onClick={() => mover(i, -1)}
                    >
                      <Icono nombre="abajo" tam={14} className="girar" />
                    </button>
                    <button
                      type="button"
                      className="icono-btn"
                      style={{ width: 26, height: 26 }}
                      aria-label={`Bajar ${e.name}`}
                      disabled={i === lista.length - 1 || ordenar.isPending}
                      onClick={() => mover(i, 1)}
                    >
                      <Icono nombre="abajo" tam={14} />
                    </button>
                  </span>
                </td>
                <td>
                  <input
                    type="color"
                    aria-label={`Color de ${e.name}`}
                    defaultValue={e.color ?? '#94a3b8'}
                    onBlur={(ev) => ev.target.value !== e.color && cambiar.mutate({ id: e.id, color: ev.target.value })}
                    style={{ width: 34, height: 28, padding: 2, cursor: 'pointer' }}
                  />
                </td>
                <td>
                  <input
                    defaultValue={e.name}
                    aria-label="Nombre de la etapa"
                    maxLength={60}
                    onBlur={(ev) => {
                      const v = ev.target.value.trim();
                      if (v && v !== e.name) cambiar.mutate({ id: e.id, name: v });
                      else ev.target.value = e.name;
                    }}
                    style={{ padding: '6px 9px', minWidth: 150 }}
                  />
                  {i === 0 && <div className="meta" style={{ marginTop: 3 }}>Entrada de leads nuevos</div>}
                </td>
                <td>
                  <select
                    aria-label={`Tipo de ${e.name}`}
                    disabled={i === 0}
                    title={i === 0 ? 'La etapa de entrada siempre está en curso' : undefined}
                    value={e.isWon ? 'ganada' : e.isLost ? 'perdida' : 'abierta'}
                    onChange={(ev) =>
                      cambiar.mutate({
                        id: e.id,
                        isWon: ev.target.value === 'ganada',
                        isLost: ev.target.value === 'perdida',
                      })
                    }
                  >
                    <option value="abierta">En curso</option>
                    <option value="ganada">Ganada (venta)</option>
                    <option value="perdida">Perdida</option>
                  </select>
                </td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{e._count.leads}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    type="button"
                    className="btn btn-sec"
                    style={{ padding: '5px 10px', fontSize: 12 }}
                    disabled={lista.length <= 1}
                    onClick={() => pedirBorrado(e)}
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {borrando && (
        <div className="card" style={{ background: 'var(--ambar-tinte)', borderColor: '#f3dfae', marginTop: 12 }}>
          <strong>«{borrando.name}» tiene {borrando._count.leads} leads</strong>
          <p className="meta" style={{ marginTop: 4 }}>
            Antes de eliminarla, elige a qué etapa pasan. Quedará anotado en el historial de cada lead.
          </p>
          <div className="acciones" style={{ alignItems: 'center' }}>
            <select value={destino} onChange={(ev) => setDestino(ev.target.value)} style={{ maxWidth: 260 }}>
              {lista.filter((x) => x.id !== borrando.id).map((x) => (
                <option key={x.id} value={x.id}>{x.name}</option>
              ))}
            </select>
            <button
              type="button"
              className="btn"
              disabled={!destino || borrar.isPending}
              onClick={() => borrar.mutate({ id: borrando.id, moverA: destino })}
            >
              Mover y eliminar
            </button>
            <button type="button" className="btn btn-sec" onClick={() => setBorrando(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      <form
        className="acciones"
        style={{ marginBottom: 0 }}
        onSubmit={(ev) => {
          ev.preventDefault();
          if (nueva.trim()) crear.mutate();
        }}
      >
        <input
          placeholder="Nueva etapa, p. ej. Propuesta enviada"
          value={nueva}
          onChange={(ev) => setNueva(ev.target.value)}
          maxLength={60}
          style={{ flex: 1, minWidth: 200 }}
        />
        <button className="btn" disabled={!nueva.trim() || crear.isPending}>
          <Icono nombre="mas" tam={15} />Agregar
        </button>
      </form>
      <p className="meta" style={{ marginTop: 8 }}>Las etapas nuevas se agregan al final; muévelas con las flechas.</p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
