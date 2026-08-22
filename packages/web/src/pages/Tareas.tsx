import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { fecha } from '../lib/format.js';

interface Tarea {
  id: string;
  type: string;
  dueAt: string;
  lead: { id: string; contact: { fname: string; lname: string | null; phone: string | null }; project: { name: string } | null };
}

/** Lo que toca hacer hoy. Es la pantalla con la que el asesor abre el día. */
export default function Tareas() {
  const { data, isLoading } = useQuery({
    queryKey: ['tareas'],
    queryFn: () => api.get<Tarea[]>('/leads/tasks/pending'),
  });

  if (isLoading) return <div className="vacio">Cargando…</div>;
  if (!data?.length) return <div className="vacio">No tienes seguimientos pendientes.</div>;

  const ahora = Date.now();
  return (
    <>
      {data.map((t) => {
        const vencida = new Date(t.dueAt).getTime() < ahora;
        return (
          <Link key={t.id} to={`/leads/${t.lead.id}`} className="card card-lead">
            <div className="fila">
              <span className="nombre">{t.lead.contact.fname} {t.lead.contact.lname ?? ''}</span>
              <span className={vencida ? 'chip chip-alerta' : 'chip chip-gris'}>
                {vencida ? 'Vencida' : 'Pendiente'}
              </span>
            </div>
            <div className="meta" style={{ marginTop: 4 }}>
              {t.type} · {fecha(t.dueAt)}{t.lead.project ? ` · ${t.lead.project.name}` : ''}
            </div>
          </Link>
        );
      })}
    </>
  );
}
