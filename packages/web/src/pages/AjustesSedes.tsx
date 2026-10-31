import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Sede } from '@lucuma-crm/shared';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';

const VACIA: Sede = { nombre: '', direccion: '', telefonoCitas: '', enlace: '' };

/**
 * Sedes de una clínica (docs/29 §4): dónde atiende el médico. Al mover a un paciente a
 * «Derivado a clínica» se elige una, y sus datos se le mandan por WhatsApp desde la ficha.
 *
 * El lead guarda el NOMBRE de la sede: renombrar una sede no reescribe los pacientes ya
 * derivados (quedan con el nombre que tenía).
 */
export default function AjustesSedes() {
  const qc = useQueryClient();
  const ajustes = useQuery({ queryKey: ['ajustes'], queryFn: () => api.get<{ sedes?: Sede[] }>('/ajustes') });
  const guardar = useMutation({
    mutationFn: (sedes: Sede[]) => api.patch('/ajustes', { sedes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ajustes'] });
      qc.invalidateQueries({ queryKey: ['ajustes-operacion'] });
      setEditando(null);
    },
  });
  const sedes = ajustes.data?.sedes ?? [];
  // null = nada abierto; -1 = sede nueva; n = editando la sede n.
  const [editando, setEditando] = useState<number | null>(null);
  const [f, setF] = useState<Sede>(VACIA);

  function abrir(i: number) {
    setF(i >= 0 ? { ...VACIA, ...sedes[i] } : VACIA);
    setEditando(i);
  }
  function limpia(x: Sede): Sede {
    const t = (v: string | null | undefined) => (v ?? '').trim() || null;
    return { nombre: x.nombre.trim(), direccion: t(x.direccion), telefonoCitas: t(x.telefonoCitas), enlace: t(x.enlace) };
  }

  const campo = (k: keyof Sede) => ({
    value: f[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value }),
  });

  return (
    <div className="card">
      <div className="fila">
        <strong>Sedes</strong>
        {editando === null && (
          <button type="button" className="btn" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => abrir(-1)}>
            <Icono nombre="mas" tam={14} />Agregar sede
          </button>
        )}
      </div>
      <p className="meta" style={{ marginTop: 6 }}>
        Las clínicas donde atiendes. Al derivar a un paciente eliges una, y desde su ficha le
        mandas la dirección y el teléfono de citas por WhatsApp.
      </p>

      {sedes.length === 0 && editando === null && <div className="vacio">Todavía no hay sedes.</div>}

      {sedes.length > 0 && (
        <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
          <thead><tr><th>Sede</th><th>Dirección</th><th>Teléfono de citas</th><th></th></tr></thead>
          <tbody>
            {sedes.map((x, i) => (
              <tr key={x.nombre}>
                <td className="t-titulo">{x.nombre}</td>
                <td data-label="Dirección">{x.direccion || '—'}</td>
                <td data-label="Teléfono de citas">{x.telefonoCitas || '—'}</td>
                <td className="accion">
                  <button type="button" className="btn btn-sec" style={{ padding: '4px 9px', fontSize: 12 }} onClick={() => abrir(i)}>Editar</button>{' '}
                  <button type="button" className="btn btn-sec" style={{ padding: '4px 9px', fontSize: 12 }} disabled={guardar.isPending}
                    onClick={() => guardar.mutate(sedes.filter((_, j) => j !== i))} aria-label={`Quitar ${x.nombre}`}>Quitar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando !== null && (
        <form
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            const nueva = limpia(f);
            if (!nueva.nombre) return;
            guardar.mutate(editando >= 0 ? sedes.map((x, j) => (j === editando ? nueva : x)) : [...sedes, nueva]);
          }}
        >
          <div className="rejilla-2">
            <div><label htmlFor="se-nombre">Nombre *</label><input id="se-nombre" {...campo('nombre')} placeholder="Clínica Delgado" maxLength={120} autoFocus /></div>
            <div><label htmlFor="se-tel">Teléfono de citas</label><input id="se-tel" {...campo('telefonoCitas')} inputMode="tel" maxLength={40} /></div>
          </div>
          <label htmlFor="se-dir">Dirección</label>
          <input id="se-dir" {...campo('direccion')} maxLength={200} />
          <label htmlFor="se-enlace">Enlace (Google Maps o reserva en línea)</label>
          <input id="se-enlace" {...campo('enlace')} placeholder="https://" maxLength={300} />
          {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
          <div className="acciones">
            <button className="btn" disabled={!f.nombre.trim() || guardar.isPending}>{guardar.isPending ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="btn btn-sec" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
