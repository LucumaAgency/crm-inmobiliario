import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { precio } from '../lib/format.js';
import { useAjustesOperacion } from './NivelInteres.js';

interface Procedimiento {
  id: string;
  code: string;
  price: string | null;
  currency: string;
  extra: { cirugia?: boolean } | null;
  project: { id: string; name: string };
}

interface Props {
  /** `sede` al derivar; `procedimiento` al marcar atendido. */
  modo: 'sede' | 'procedimiento';
  nombre: string;
  etapa: string;
  onConfirmar: (valor: string) => void;
  onCancelar: () => void;
  pendiente?: boolean;
  error?: string | null;
}

/**
 * Lo que pide la clínica al mover a un paciente (docs/29): a qué sede se derivó, o qué
 * procedimiento se le hizo. El servidor exige ambos (400 sin ellos), igual que el motivo de
 * pérdida, así que sin este diálogo el arrastre en el tablero fallaría.
 */
export default function DatoEtapaClinica({ modo, nombre, etapa, onConfirmar, onCancelar, pendiente, error }: Props) {
  const operacion = useAjustesOperacion();
  const procedimientos = useQuery({
    queryKey: ['catalogo-unidades'],
    queryFn: () => api.get<Procedimiento[]>('/catalogo/unidades'),
    enabled: modo === 'procedimiento',
  });
  const [valor, setValor] = useState('');

  const sedes = operacion.data?.sedes ?? [];
  const lista = procedimientos.data ?? [];
  const porEspecialidad = new Map<string, Procedimiento[]>();
  for (const p of lista) {
    if (!porEspecialidad.has(p.project.name)) porEspecialidad.set(p.project.name, []);
    porEspecialidad.get(p.project.name)!.push(p);
  }
  const vacio = modo === 'sede' ? operacion.isSuccess && sedes.length === 0 : procedimientos.isSuccess && lista.length === 0;

  return (
    <div className="modal-fondo" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>{modo === 'sede' ? '¿A qué sede lo derivaste?' : '¿Qué se le hizo?'}</h2>
          <button type="button" className="cerrar" onClick={onCancelar} aria-label="Cerrar">×</button>
        </div>
        <p className="meta">
          <strong>{nombre}</strong> pasa a <strong>{etapa}</strong>.{' '}
          {modo === 'sede'
            ? 'En 7 días te aparece un seguimiento para confirmar si se atendió.'
            : 'El procedimiento queda en el historial y en el reporte de atendidos del mes.'}
        </p>

        {vacio ? (
          <p className="meta">
            {modo === 'sede' ? (
              <>Todavía no hay sedes. <Link to="/ajustes?seccion=sedes" onClick={onCancelar}>Regístralas en Ajustes → Sedes</Link>.</>
            ) : (
              <>Todavía no hay procedimientos. <Link to="/proyectos" onClick={onCancelar}>Cárgalos en Especialidades</Link>.</>
            )}
          </p>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (valor) onConfirmar(valor); }}>
            <label htmlFor="dec-valor">{modo === 'sede' ? 'Sede' : 'Procedimiento'}</label>
            <select id="dec-valor" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus>
              <option value="">Elegir…</option>
              {modo === 'sede'
                ? sedes.map((s) => <option key={s.nombre} value={s.nombre}>{s.nombre}</option>)
                : [...porEspecialidad.entries()].map(([esp, procs]) => (
                    <optgroup key={esp} label={esp}>
                      {procs.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code}{p.extra?.cirugia ? ' · cirugía' : ''}{p.price ? ` · ${precio(p.price, p.currency)}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
            </select>
            {error && <p className="error">{error}</p>}
            <div className="acciones" style={{ marginTop: 16 }}>
              <button type="submit" className="btn" disabled={!valor || pendiente}>
                {pendiente ? 'Guardando…' : `Mover a ${etapa}`}
              </button>
              <button type="button" className="btn btn-sec" onClick={onCancelar}>Cancelar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
