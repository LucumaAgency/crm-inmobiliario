import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Props {
  nombre: string;
  etapa: string;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
  pendiente?: boolean;
  error?: string | null;
}

/**
 * Pide el motivo al mover un lead a una etapa perdida.
 *
 * Los motivos los configura la organización en Ajustes → Embudo; «Otro» abre texto libre.
 * El servidor exige el motivo (400 sin él), así que esto no es una cortesía de interfaz:
 * sin este diálogo el arrastre al Kanban fallaría en silencio.
 */
export default function MotivoPerdida({ nombre, etapa, onConfirmar, onCancelar, pendiente, error }: Props) {
  const motivos = useQuery({
    queryKey: ['motivos-perdida'],
    queryFn: () => api.get<{ motivosPerdida: string[] }>('/ajustes/operacion'),
    staleTime: 5 * 60 * 1000,
  });
  const lista = motivos.data?.motivosPerdida ?? [];
  const [elegido, setElegido] = useState('');
  const [otro, setOtro] = useState('');
  const esOtro = elegido === '__otro' || lista.length === 0;
  const motivo = (esOtro ? otro : elegido).trim();

  return (
    <div className="modal-fondo" onClick={onCancelar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>¿Por qué se pierde?</h2>
          <button type="button" className="cerrar" onClick={onCancelar} aria-label="Cerrar">×</button>
        </div>
        <p className="meta">
          <strong>{nombre}</strong> pasa a <strong>{etapa}</strong>. El motivo queda en el historial y en
          los reportes: es lo que permite saber si se pierde por precio, por zona o por crédito.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (motivo) onConfirmar(motivo);
          }}
        >
          {lista.length > 0 && (
            <>
              <label htmlFor="mp-motivo">Motivo</label>
              <select id="mp-motivo" value={elegido} onChange={(e) => setElegido(e.target.value)} autoFocus>
                <option value="">Elegir un motivo</option>
                {lista.map((m) => <option key={m} value={m}>{m}</option>)}
                <option value="__otro">Otro…</option>
              </select>
            </>
          )}
          {esOtro && (
            <>
              <label htmlFor="mp-otro">Detalle</label>
              <input
                id="mp-otro"
                value={otro}
                onChange={(e) => setOtro(e.target.value)}
                placeholder="Qué pasó, en una línea"
                maxLength={200}
                autoFocus={lista.length === 0}
              />
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div className="acciones" style={{ marginTop: 16 }}>
            <button type="submit" className="btn" disabled={!motivo || pendiente}>
              {pendiente ? 'Guardando…' : 'Mover a perdido'}
            </button>
            <button type="button" className="btn btn-sec" onClick={onCancelar}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
