/**
 * Visor del log de la aplicación.
 *
 * Existe porque durante la puesta en marcha de los webhooks hubo que distinguir «el
 * aviso no llegó» de «llegó y lo descartamos», y las dos cosas se veían igual desde
 * fuera. El log estaba, pero solo alcanzable por el Administrador de archivos de Plesk.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Respuesta {
  archivo: string;
  existe: boolean;
  lineas: string[];
}

const ATAJOS = ['wa:', 'meta:', 'cron:', '[cola]', 'error'];

export default function Registro() {
  const [filtro, setFiltro] = useState('');
  const [auto, setAuto] = useState(true);

  const log = useQuery({
    queryKey: ['logs', filtro],
    queryFn: () =>
      api.get<Respuesta>(`/logs?lines=300${filtro ? `&q=${encodeURIComponent(filtro)}` : ''}`),
    refetchInterval: auto ? 5000 : false,
  });

  return (
    <div className="card">
      <div className="fila">
        <strong>Registro del servidor</strong>
        <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          actualizar solo
        </label>
      </div>
      <p className="meta" style={{ marginTop: 4 }}>
        Últimas líneas de <code>{log.data?.archivo ?? 'logs/app.txt'}</code>.
        {log.data && !log.data.existe && ' El archivo todavía no existe.'}
      </p>

      <div className="acciones" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        {ATAJOS.map((a) => (
          <button
            key={a}
            type="button"
            className={filtro === a ? 'btn' : 'btn btn-sec'}
            onClick={() => setFiltro(filtro === a ? '' : a)}
          >
            {a}
          </button>
        ))}
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="filtrar…"
          style={{ maxWidth: 220 }}
        />
      </div>

      <pre className="registro">
        {log.isLoading
          ? 'Cargando…'
          : log.data?.lineas.length
            ? log.data.lineas.join('\n')
            : 'Sin líneas que coincidan.'}
      </pre>

      {log.isError && (
        <p className="error">
          {(log.error as Error).message} — este visor es solo para el rol Admin Lucuma.
        </p>
      )}
    </div>
  );
}
