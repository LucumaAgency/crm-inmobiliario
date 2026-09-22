import { Link, useNavigate } from 'react-router-dom';
import { desde } from '../lib/format.js';
import { FUENTES } from '../lib/reportes.js';

export interface LeadFila {
  id: string;
  createdAt: string;
  firstContactAt: string | null;
  source: string;
  contact: { fname: string; lname: string | null; phone: string | null; email: string | null };
  project: { name: string } | null;
  unit: { code: string } | null;
  stage: { name: string; color: string | null } | null;
  owner: { name: string } | null;
  /** Conversación de WhatsApp del contacto, si tiene. */
  whatsapp: { unread: number; lastInboundAt: string | null } | null;
}

/** El SLA de primer contacto: pasados 15 minutos sin tocarlo, el lead se enfría. */
function enRiesgo(l: LeadFila) {
  return !l.firstContactAt && (Date.now() - new Date(l.createdAt).getTime()) / 60000 > 15;
}

function iniciales(l: LeadFila) {
  return `${l.contact.fname[0] ?? ''}${l.contact.lname?.[0] ?? ''}`.toUpperCase();
}

function Alertas({ l }: { l: LeadFila }) {
  const sinLeer = l.whatsapp?.unread ?? 0;
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      {sinLeer > 0 && (
        <span className="chip chip-verde">
          {sinLeer === 1 ? '1 mensaje sin leer' : `${sinLeer} sin leer`}
        </span>
      )}
      {enRiesgo(l) && <span className="chip chip-alerta">Sin contactar</span>}
    </span>
  );
}

function Etapa({ stage }: { stage: LeadFila['stage'] }) {
  if (!stage) return <span className="meta">—</span>;
  return (
    <span className="estado">
      <i style={{ background: stage.color ?? 'var(--tenue)' }} />
      {stage.name}
    </span>
  );
}

/** Escritorio: tabla. Móvil: tarjetas, que se leen con el pulgar. */
export default function TablaLeads({ leads, compacta = false }: { leads: LeadFila[]; compacta?: boolean }) {
  const navegar = useNavigate();

  return (
    <>
      <div className="solo-escritorio tabla-scroll">
        <table className="tabla">
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Proyecto</th>
              {!compacta && <th>Fuente</th>}
              <th>Etapa</th>
              <th>Asesor</th>
              <th>Entró</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((l) => (
              <tr key={l.id} className="enlace" onClick={() => navegar(`/leads/${l.id}`)}>
                <td>
                  <Link to={`/leads/${l.id}`} className="celda-nombre" style={{ color: 'inherit' }}>
                    <span className="ficha-icono">{iniciales(l)}</span>
                    <span>
                      {(l.whatsapp?.unread ?? 0) > 0 && <span className="punto" aria-hidden="true" />}
                      {l.contact.fname} {l.contact.lname ?? ''}
                      <div className="meta" style={{ fontWeight: 400 }}>{l.contact.phone ?? l.contact.email ?? ''}</div>
                    </span>
                  </Link>
                </td>
                <td>
                  {l.project?.name ?? <span className="meta">—</span>}
                  {l.unit && <div className="meta">Unidad {l.unit.code}</div>}
                </td>
                {!compacta && <td>{FUENTES[l.source] ?? l.source}</td>}
                <td><Etapa stage={l.stage} /></td>
                <td>{l.owner?.name ?? <span className="meta">Sin asignar</span>}</td>
                <td className="meta" style={{ whiteSpace: 'nowrap' }}>{desde(l.createdAt)}</td>
                <td style={{ textAlign: 'right' }}><Alertas l={l} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="solo-movil">
        {leads.map((l) => {
          const sinLeer = l.whatsapp?.unread ?? 0;
          return (
            <Link
              key={l.id}
              to={`/leads/${l.id}`}
              className={sinLeer > 0 ? 'card card-lead card-sin-leer' : 'card card-lead'}
            >
              <div className="fila">
                <span className="nombre">
                  {sinLeer > 0 && <span className="punto" aria-hidden="true" />}
                  {l.contact.fname} {l.contact.lname ?? ''}
                </span>
                <Etapa stage={l.stage} />
              </div>
              <div className="meta" style={{ marginTop: 4 }}>
                {[l.project?.name, l.unit?.code && `Unidad ${l.unit.code}`, l.contact.phone]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              <div className="fila" style={{ marginTop: 8 }}>
                <span className="meta">{desde(l.createdAt)} · {l.owner?.name ?? 'sin asignar'}</span>
                <Alertas l={l} />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
