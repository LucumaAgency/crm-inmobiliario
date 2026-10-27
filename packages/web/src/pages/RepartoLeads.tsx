/**
 * A quién van los leads nuevos: un usuario fijo (p. ej. el jefe de ventas, que luego los
 * reparte a mano) o el reparto automático entre los asesores activos.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Usuario {
  id: string;
  name: string;
  email: string;
  active: boolean;
}

export default function RepartoLeads() {
  const qc = useQueryClient();
  const reparto = useQuery({ queryKey: ['reparto'], queryFn: () => api.get<{ asesorPorDefecto: string | null }>('/reparto') });
  const usuarios = useQuery({ queryKey: ['users'], queryFn: () => api.get<Usuario[]>('/users') });
  const guardar = useMutation({
    mutationFn: (asesorPorDefecto: string | null) => api.put('/reparto', { asesorPorDefecto }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reparto'] }),
  });

  const activos = (usuarios.data ?? []).filter((u) => u.active);
  const actual = reparto.data?.asesorPorDefecto ?? '';
  // Si el elegido se desactivó, el servidor ya reparte solo; aquí se avisa.
  const elegidoInactivo = !!actual && !!usuarios.data && !activos.some((u) => u.id === actual);

  return (
    <div className="card">
      <strong>Asignación de leads nuevos</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Todo lead que entre (formulario web, WhatsApp, Meta o alta manual) se asigna a este
        usuario. Con «Reparto automático» se turnan entre los asesores activos.
      </p>
      <label htmlFor="reparto-asesor">Asesor por defecto</label>
      <select
        id="reparto-asesor"
        value={elegidoInactivo ? '' : actual}
        disabled={reparto.isLoading || guardar.isPending}
        onChange={(e) => guardar.mutate(e.target.value || null)}
        style={{ maxWidth: 360 }}
      >
        <option value="">Reparto automático entre asesores</option>
        {activos.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
      {elegidoInactivo && (
        <p className="meta" style={{ marginTop: 6 }}>
          El usuario elegido está desactivado: mientras tanto se usa el reparto automático.
        </p>
      )}
      {guardar.isSuccess && <p className="meta" style={{ marginTop: 6 }}>Guardado.</p>}
      {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
    </div>
  );
}
