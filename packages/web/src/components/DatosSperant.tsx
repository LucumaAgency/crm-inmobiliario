import { Link } from 'react-router-dom';

type Plano = Record<string, unknown>;

/**
 * Todo lo que trajo Sperant y el CRM no tiene como campo propio: género, estado civil,
 * ubicación, pareja, teléfono principal, campos extra, interacciones, enlace al cotizador.
 *
 * Arriba lo legible; abajo, «todos los campos» tal cual llegaron, para que ningún dato se
 * pierda aunque no tenga etiqueta aquí.
 */

const GENERO: Record<string, string> = { m: 'Masculino', f: 'Femenino' };
const CIVIL: Record<string, string> = { S: 'Soltero(a)', C: 'Casado(a)', D: 'Divorciado(a)', V: 'Viudo(a)' };

/** Sperant mezcla segundos Unix y fechas ISO. */
function valor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number' && v > 1_000_000_000 && v < 4_000_000_000) return fechaLarga(new Date(v * 1000));
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fechaLarga(new Date(v));
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function fechaLarga(d: Date) {
  return d.toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function aplanar(o: unknown, pre = '', out: [string, string][] = []): [string, string][] {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Plano)) aplanar(v, pre ? `${pre}.${k}` : k, out);
  } else if (Array.isArray(o)) {
    o.forEach((v, i) => aplanar(v, `${pre}[${i}]`, out));
  } else {
    const t = valor(o);
    if (t) out.push([pre, t]);
  }
  return out;
}

export default function DatosSperant({
  attribution,
  pareja,
}: {
  attribution: Record<string, unknown> | null;
  pareja?: { id: string; nombre: string } | null;
}) {
  const sp = attribution?.sperant as (Plano & { cliente?: Plano; proyectos?: Plano[] }) | undefined;
  if (!sp) return null;
  const c = sp.cliente ?? {};
  const pr = sp.proyectos ?? [];
  const ub = (c.ubication ?? {}) as Plano;
  const extras = (c.extra_fields ?? {}) as Plano;
  const fusiones = (attribution?.sperant_fusiones_datos ?? {}) as Record<string, { cliente?: Plano }>;
  const doc = typeof c.document === 'string' ? c.document : '';

  const filas: [string, React.ReactNode][] = [
    ['Cliente en Sperant', `#${sp.client_id}`],
    ['Género', GENERO[String(c.gender)] ?? valor(c.gender)],
    ['Estado civil', CIVIL[String(c.marital_status)] ?? valor(c.marital_status)],
    ['Tipo de persona', valor(c.person_type)],
    ['Documento en Sperant', doc && /^auto-/i.test(doc) ? 'no cargado (Sperant puso un código automático)' : [valor(c.document_type), doc].filter(Boolean).join(' ')],
    ['Teléfono principal', c.main_telephone && c.main_telephone !== c.phone ? valor(c.main_telephone) : ''],
    ['Usuario de WhatsApp', valor(c.wsp_username ?? sp.wsp_username)],
    ['Ubicación', [ub.address, ub.state, ub.country].filter(Boolean).map(String).join(', ')],
    ['Pareja / cónyuge', c.couple_id ? (pareja ? <Link to={`/leads/${pareja.id}`}>{pareja.nombre}</Link> : `cliente Sperant #${c.couple_id}`) : ''],
    ['Referido por', c.referred_id ? `cliente Sperant #${c.referred_id}` : ''],
    ['Observación', valor(c.observation)],
    ['Motivo de descarte', valor(c.reason_resign_name)],
    ['Tipo de interés', valor(pr[0]?.interest_type_name ?? c.interest_type ?? sp.interes)],
    ['Canal / medio', [pr[0]?.input_channel_name ?? sp.canal, pr[0]?.source_name ?? sp.medio].filter(Boolean).map(String).join(' / ')],
    ['Etapa en Sperant', valor(pr[0]?.segment_name ?? sp.etapa)],
    ['Asesor en Sperant', valor(pr[0]?.seller_username ?? sp.asesor)],
    ['Asignado el', valor(pr[0]?.seller_assigned_at ?? sp.asignado_el)],
    ['Última interacción manual', valor(pr[0]?.last_manual_interaction_at)],
    ['Última interacción digital', valor(pr[0]?.last_digital_interaction_at)],
    ['Acepta correos / publicidad', [c.email_consent, c.publicity_consent].some((x) => typeof x === 'boolean') ? `${valor(c.email_consent) || '—'} / ${valor(c.publicity_consent) || '—'}` : ''],
    ...Object.entries(extras).map(([k, v]) => [`Campo extra: ${k}`, valor(v)] as [string, string]),
    ['Otros proyectos en Sperant', pr.slice(1).map((p) => `${p.name} (${p.segment_name ?? 'sin etapa'})`).join(', ')],
    ['También registrado como', Object.keys(fusiones).map((id) => `#${id}`).join(', ')],
  ];
  const visibles = filas.filter(([, v]) => v !== '' && v !== null && v !== undefined);
  const todos = aplanar({ cliente: c, proyectos: pr, ...(Object.keys(fusiones).length ? { otros_registros: fusiones } : {}) });

  return (
    <div className="card">
      <strong>Datos de Sperant</strong>
      {!sp.cliente && (
        <p className="meta" style={{ marginTop: 6 }}>
          Este lead se importó antes de que se guardara la ficha completa. Se completa desde Ajustes → Migración
          Sperant → «Completar datos de leads ya importados».
        </p>
      )}
      <table className="tabla-compacta" style={{ marginTop: 8 }}>
        <tbody>
          {visibles.map(([k, v]) => (
            <tr key={k}>
              <td className="meta" style={{ paddingRight: 12, whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k}</td>
              <td style={{ whiteSpace: 'pre-wrap' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {typeof pr[0]?.budget_web_link === 'string' && (
        <p className="meta" style={{ marginTop: 6 }}>
          <a href={pr[0].budget_web_link} target="_blank" rel="noreferrer">Cotizador del cliente en Sperant</a> (deja de
          funcionar cuando se apague Sperant)
        </p>
      )}
      {todos.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary className="meta">Todos los campos tal como llegaron de Sperant ({todos.length})</summary>
          <table className="tabla-compacta" style={{ marginTop: 6 }}>
            <tbody>
              {todos.map(([k, v]) => (
                <tr key={k}>
                  <td className="meta" style={{ paddingRight: 12, verticalAlign: 'top' }}>{k}</td>
                  <td style={{ wordBreak: 'break-word' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
