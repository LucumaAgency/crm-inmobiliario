import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

/**
 * Confirmación para borrar leads para siempre.
 *
 * Con más de uno hay que escribir BORRAR: un clic de más en una selección grande no puede
 * llevarse la base. Avisa de los que vinieron de Sperant, porque volverían a entrar si se
 * corre otra vez la importación.
 */
export default function BorrarLeads({
  ids,
  deSperant = 0,
  nombre,
  onCerrar,
  onBorrado,
}: {
  ids: string[];
  /** Cuántos de los seleccionados se trajeron de Sperant. */
  deSperant?: number;
  /** Nombre del lead cuando es uno solo. */
  nombre?: string;
  onCerrar: () => void;
  onBorrado: (r: { borrados: number; contactosBorrados: number }) => void;
}) {
  const qc = useQueryClient();
  const [texto, setTexto] = useState('');
  const varios = ids.length > 1;
  const borrar = useMutation({
    mutationFn: () => api.post<{ borrados: number; contactosBorrados: number }>('/leads/borrar', { ids }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
      onBorrado(r);
    },
  });
  const listo = !varios || texto.trim().toUpperCase() === 'BORRAR';

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>{varios ? `Borrar ${ids.length} leads` : `Borrar ${nombre ?? 'este lead'}`}</h2>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        <p>
          Se borra{varios ? 'n' : ''} para siempre, con sus actividades, seguimientos, proformas y
          notas de voz. Si el contacto no tiene otro lead, también se borran el contacto y su chat de
          WhatsApp. <strong>No se puede deshacer.</strong>
        </p>
        {deSperant > 0 && (
          <p className="meta">
            {!varios
              ? 'Este lead vino de Sperant: si vuelves a correr la importación, volverá a entrar.'
              : `${deSperant} de estos vinieron de Sperant: si vuelves a correr la importación, volverán a entrar.`}
          </p>
        )}
        {varios && (
          <>
            <label htmlFor="confirmar-borrado">Escribe BORRAR para confirmar</label>
            <input id="confirmar-borrado" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
          </>
        )}
        {borrar.isError && <p className="error">{(borrar.error as Error).message}</p>}
        <div className="acciones">
          <button type="button" className="btn btn-sec" onClick={onCerrar}>Cancelar</button>
          <button
            type="button"
            className="btn btn-peligro"
            disabled={!listo || borrar.isPending}
            onClick={() => borrar.mutate()}
          >
            {borrar.isPending ? 'Borrando…' : varios ? `Borrar ${ids.length} leads` : 'Borrar lead'}
          </button>
        </div>
      </div>
    </div>
  );
}
