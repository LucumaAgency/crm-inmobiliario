import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fecha } from '../lib/format.js';

interface Form {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  project: { name: string } | null;
  site: { name: string } | null;
  _count: { submissions: number };
}

export default function Formularios() {
  const { data, isLoading } = useQuery({ queryKey: ['forms'], queryFn: () => api.get<Form[]>('/forms') });

  if (isLoading) return <div className="vacio">Cargando…</div>;

  return (
    <>
      <div className="fila" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Formularios</h2>
        <Link className="btn" to="/formularios/nuevo">Nuevo</Link>
      </div>

      {!data?.length && (
        <div className="vacio">
          Todavía no hay formularios. Crea uno y pégalo en el sitio con el conector de WordPress.
        </div>
      )}

      {data?.map((f) => (
        <Link key={f.id} to={`/formularios/${f.id}`} className="card card-lead">
          <div className="fila">
            <span className="nombre">{f.name}</span>
            <span className="chip chip-gris">v{f.version}</span>
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            {[f.project?.name, f.site?.name].filter(Boolean).join(' · ')} · {f._count.submissions} envíos
          </div>
          <div className="meta">Actualizado {fecha(f.updatedAt)}</div>
          <div className="codigo" style={{ marginTop: 8, display: 'inline-block' }}>{f.id}</div>
        </Link>
      ))}
    </>
  );
}
