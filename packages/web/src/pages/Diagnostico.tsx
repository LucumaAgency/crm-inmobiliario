import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Llave {
  id: string;
  creadaEl: string;
  venceEl: string;
  creadaPor: string;
  revocadaEl?: string | null;
  vigente: boolean;
}

/**
 * Ajustes → Diagnóstico: llaves de solo lectura para que soporte revise la organización.
 * Ver `routes/diagnostico.ts` para qué devuelve (cifras, nunca datos de clientes).
 */
export default function Diagnostico() {
  const qc = useQueryClient();
  const llaves = useQuery({ queryKey: ['diagnostico-llaves'], queryFn: () => api.get<Llave[]>('/diagnostico/llaves') });
  const [nueva, setNueva] = useState<{ llave: string; venceEl: string } | null>(null);
  const [copiada, setCopiada] = useState(false);
  const crear = useMutation({
    mutationFn: () => api.post<{ llave: string; venceEl: string }>('/diagnostico/llaves'),
    onSuccess: (r) => {
      setNueva(r);
      setCopiada(false);
      qc.invalidateQueries({ queryKey: ['diagnostico-llaves'] });
    },
  });
  const revocar = useMutation({
    mutationFn: (id: string) => api.del(`/diagnostico/llaves/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['diagnostico-llaves'] }),
  });
  const fecha = (t: string) => new Date(t).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const vigentes = llaves.data?.filter((l) => l.vigente) ?? [];

  return (
    <div className="card">
      <strong>Diagnóstico para soporte</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Genera una llave de <strong>solo lectura</strong> para que Lucuma revise el estado del CRM sin entrar con tu
        usuario: cifras de leads por etapa, asesor y proyecto, inventario, usuarios y la comparación con Sperant.
        <strong> No incluye nombres, teléfonos, correos ni documentos de clientes.</strong> Vence sola a las 24 horas, se
        puede revocar antes y cada consulta queda en el registro.
      </p>
      <div className="acciones">
        <button type="button" className="btn" disabled={crear.isPending} onClick={() => crear.mutate()}>
          {crear.isPending ? 'Generando…' : 'Generar llave (24 h)'}
        </button>
      </div>
      {crear.isError && <p className="error">{(crear.error as Error).message}</p>}
      {nueva && (
        <div style={{ marginTop: 10 }}>
          <p className="meta">Cópiala ahora: no se vuelve a mostrar. Vence el {fecha(nueva.venceEl)}.</p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input readOnly value={nueva.llave} onFocus={(e) => e.target.select()} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
            <button
              type="button"
              className="btn btn-sec"
              onClick={() => {
                navigator.clipboard?.writeText(nueva.llave).then(() => setCopiada(true), () => setCopiada(false));
              }}
            >
              {copiada ? 'Copiada' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
      {vigentes.length > 0 && (
        <table className="tabla-compacta" style={{ marginTop: 12 }}>
          <tbody>
            {vigentes.map((l) => (
              <tr key={l.id}>
                <td>Creada el {fecha(l.creadaEl)} por {l.creadaPor} · vence el {fecha(l.venceEl)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button type="button" className="btn btn-sec" disabled={revocar.isPending} onClick={() => revocar.mutate(l.id)}>
                    Revocar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
