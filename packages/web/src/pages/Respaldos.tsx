import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { usePuede } from '../lib/permisos.js';

interface Zip {
  nombre: string;
  bytes: number;
  creadoEl: string;
}

interface Estado {
  activos: boolean;
  drive: boolean;
  automatico: {
    ultimoOk: string | null;
    ultimoIntento: string | null;
    archivo: string | null;
    bytes: number | null;
    drive: { id: string } | { error: string } | null;
    error: string | null;
  };
  enServidor: Zip[];
  descargas: Zip[];
  generando: boolean;
}

const fecha = (t: string) =>
  new Date(t).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const peso = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/**
 * Ajustes → Respaldos. Ver `services/respaldos.ts`: el automático (diario, a Drive de Lucuma)
 * y la descarga del cliente (sin credenciales, con planillas para Excel).
 */
export default function Respaldos() {
  const qc = useQueryClient();
  const puede = usePuede();
  const estado = useQuery({ queryKey: ['respaldos'], queryFn: () => api.get<Estado>('/respaldos') });
  const generar = useMutation({
    mutationFn: () => api.post<{ nombre: string; bytes: number }>('/respaldos'),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['respaldos'] });
      window.location.href = `/api/v1/respaldos/descargar/${encodeURIComponent(r.nombre)}`;
    },
  });
  const forzar = useMutation({
    mutationFn: () => api.post<Estado['automatico']>('/respaldos/automatico'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['respaldos'] }),
  });

  const e = estado.data;
  const a = e?.automatico;
  const horasDesde = a?.ultimoOk ? (Date.now() - new Date(a.ultimoOk).getTime()) / 3600_000 : null;
  const alDia = horasDesde !== null && horasDesde < 30;

  return (
    <>
      <div className="card">
        <strong>Respaldo automático</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Todos los días de madrugada se guarda una copia completa de la información (leads, seguimientos, conversaciones,
          proformas, inventario y archivos) fuera del servidor del CRM. Se conservan los últimos 30 días.
        </p>
        {estado.isLoading && <p className="meta">Cargando…</p>}
        {e && !e.activos && <p className="error">El respaldo automático está apagado en esta instalación.</p>}
        {a && (
          <>
            {a.ultimoOk ? (
              <p className={alDia ? 'ok' : 'error'}>
                Último respaldo guardado fuera del servidor: {fecha(a.ultimoOk)}
                {!alDia && ' · hace más de un día'}
              </p>
            ) : (
              <p className="meta">Todavía no hay un respaldo guardado fuera del servidor.</p>
            )}
            {a.error && (
              <p className="error">
                Último intento ({a.ultimoIntento ? fecha(a.ultimoIntento) : '—'}): {a.error}
              </p>
            )}
          </>
        )}
        {puede('registro.ver') && e && (
          <>
            <p className="meta" style={{ marginTop: 10 }}>
              Solo Lucuma: Drive {e.drive ? 'configurado' : 'SIN configurar (faltan GDRIVE_* en el entorno)'}.
              {e.enServidor.length > 0 &&
                ` En el servidor: ${e.enServidor.map((z) => `${z.nombre} (${peso(z.bytes)})`).join(', ')}.`}
            </p>
            <div className="acciones">
              <button type="button" className="btn btn-sec" disabled={forzar.isPending} onClick={() => forzar.mutate()}>
                {forzar.isPending ? 'Respaldando…' : 'Respaldar ahora'}
              </button>
            </div>
            {forzar.isError && <p className="error">{(forzar.error as Error).message}</p>}
          </>
        )}
      </div>

      <div className="card">
        <strong>Descargar una copia</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Un archivo ZIP con toda tu información: planillas que se abren en Excel (leads, contactos, seguimientos, proformas,
          unidades y mensajes de WhatsApp), los datos completos y los archivos (proformas en PDF, notas de voz, adjuntos,
          planos). No incluye contraseñas ni accesos a Meta o WhatsApp. La descarga queda registrada en la auditoría.
        </p>
        <div className="acciones">
          <button type="button" className="btn" disabled={generar.isPending || e?.generando} onClick={() => generar.mutate()}>
            {generar.isPending ? 'Preparando el archivo…' : 'Generar y descargar'}
          </button>
        </div>
        {generar.isError && <p className="error">{(generar.error as Error).message}</p>}
        {e && e.descargas.length > 0 && (
          <table className="tabla-compacta" style={{ marginTop: 12 }}>
            <tbody>
              {e.descargas.map((z) => (
                <tr key={z.nombre}>
                  <td>
                    {fecha(z.creadoEl)} · {peso(z.bytes)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <a className="btn btn-sec" href={`/api/v1/respaldos/descargar/${encodeURIComponent(z.nombre)}`}>
                      Descargar
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
