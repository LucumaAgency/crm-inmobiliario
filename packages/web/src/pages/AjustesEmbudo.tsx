import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';

interface Ajustes {
  motivosPerdida: string[];
  descuentoMaximoPct: number | null;
}

/**
 * Motivos de pérdida y descuento máximo de la organización. Viven en Ajustes → Embudo
 * porque son reglas de cómo se trabaja el embudo, no de un canal.
 */
export default function AjustesEmbudo() {
  const qc = useQueryClient();
  const ajustes = useQuery({ queryKey: ['ajustes'], queryFn: () => api.get<Ajustes>('/ajustes') });
  const guardar = useMutation({
    mutationFn: (cambios: Partial<Ajustes>) => api.patch('/ajustes', cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ajustes'] });
      qc.invalidateQueries({ queryKey: ['motivos-perdida'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const [nuevo, setNuevo] = useState('');
  const [descuento, setDescuento] = useState('');
  useEffect(() => {
    if (ajustes.data) setDescuento(ajustes.data.descuentoMaximoPct == null ? '' : String(ajustes.data.descuentoMaximoPct));
  }, [ajustes.data]);

  const motivos = ajustes.data?.motivosPerdida ?? [];

  function guardarDescuento() {
    const t = descuento.trim();
    const actual = ajustes.data?.descuentoMaximoPct ?? null;
    if (t === '') { if (actual !== null) guardar.mutate({ descuentoMaximoPct: null }); return; }
    const n = Number(t.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      if (n !== actual) guardar.mutate({ descuentoMaximoPct: Math.round(n * 100) / 100 });
    } else setDescuento(actual == null ? '' : String(actual));
  }

  return (
    <>
      <div className="card">
        <strong>Motivos de pérdida</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Al mover un lead a una etapa perdida, el asesor elige uno de estos motivos o escribe
          otro. Es obligatorio: un lead desestimado sin razón no enseña nada. Con el tiempo, el
          reporte de motivos dice si se pierde por precio, por zona o por crédito.
        </p>
        <ul className="lista-motivos">
          {motivos.map((m, i) => (
            <li key={m}>
              <span>{m}</span>
              <button
                type="button"
                className="btn btn-sec"
                style={{ padding: '4px 9px', fontSize: 12 }}
                disabled={guardar.isPending}
                onClick={() => guardar.mutate({ motivosPerdida: motivos.filter((_, j) => j !== i) })}
                aria-label={`Quitar ${m}`}
              >
                Quitar
              </button>
            </li>
          ))}
          {motivos.length === 0 && <li className="meta">Sin motivos: el asesor escribirá el suyo cada vez.</li>}
        </ul>
        <form
          className="acciones"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            const t = nuevo.trim();
            if (!t || motivos.includes(t)) return;
            guardar.mutate({ motivosPerdida: [...motivos, t] });
            setNuevo('');
          }}
        >
          <input
            placeholder="Nuevo motivo, p. ej. Prefirió una casa"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            maxLength={120}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn" disabled={!nuevo.trim() || guardar.isPending}>
            <Icono nombre="mas" tam={15} />Agregar
          </button>
        </form>
        {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
      </div>

      <div className="card">
        <strong>Descuentos</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Tope de descuento (%) que un asesor puede ofrecer en una proforma si no tiene uno
          propio en Usuarios. Vacío = sin tope. Los precios de lista los cambia solo gerencia,
          y cada cambio queda en el registro de auditoría.
        </p>
        <label htmlFor="desc-org">Descuento máximo de la organización</label>
        <span className="porcentaje">
          <input
            id="desc-org"
            type="text"
            inputMode="decimal"
            value={descuento}
            placeholder="sin tope"
            onChange={(e) => setDescuento(e.target.value)}
            onBlur={guardarDescuento}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ width: 90, textAlign: 'right' }}
          />
          <span className="meta">%</span>
        </span>
      </div>
    </>
  );
}
