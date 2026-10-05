import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { precio } from '../lib/format.js';

interface Tipologia { id: string; name: string; bedrooms: number | null; areaM2: string | null; priceFrom: string | null; currency: string; active: boolean }
interface Unidad { id: string; code: string; status: string; bedrooms: number | null; areaM2: string | null; price: string | null; currency: string; typologyRef: { id: string; name: string } | null }

interface Props {
  projectId: string;
  typologyIds: string[];
  unitIds: string[];
  onChange: (v: { typologyIds: string[]; unitIds: string[] }) => void;
  disabled?: boolean;
}

const ESTADO: Record<string, string> = {
  disponible: '', reservado: 'reservada', vendido: 'vendida', no_disponible: 'no disponible',
};

/**
 * Tipologías y unidades que le interesan al lead, dentro de un proyecto.
 *
 * Son casillas y no un select múltiple: en el celular el select múltiple es inusable y el
 * asesor marca esto con el cliente al teléfono. Marcar una tipología no marca sus unidades:
 * «cualquier 3 dormitorios» y «el 302 en concreto» son dos cosas distintas y conviven.
 * Las unidades se agrupan por tipología para que la lista de 40 departamentos se lea.
 */
export default function SelectorInteres({ projectId, typologyIds, unitIds, onChange, disabled }: Props) {
  const tipologias = useQuery({
    queryKey: ['typologies', projectId],
    queryFn: () => api.get<Tipologia[]>(`/projects/${projectId}/typologies`),
    enabled: Boolean(projectId),
  });
  const unidades = useQuery({
    queryKey: ['units', projectId],
    queryFn: () => api.get<Unidad[]>(`/projects/${projectId}/units`),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;
  if (tipologias.isLoading || unidades.isLoading) return <p className="meta">Cargando inventario…</p>;

  const tips = (tipologias.data ?? []).filter((t) => t.active || typologyIds.includes(t.id));
  const unis = unidades.data ?? [];
  if (tips.length === 0 && unis.length === 0) {
    return <p className="meta">Este proyecto todavía no tiene tipologías ni unidades cargadas.</p>;
  }

  function alternar(lista: string[], id: string) {
    return lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];
  }

  // Agrupar unidades por tipología; las sin tipología van al final.
  const grupos = new Map<string, { nombre: string; items: Unidad[] }>();
  for (const u of unis) {
    const k = u.typologyRef?.id ?? '_sin';
    if (!grupos.has(k)) grupos.set(k, { nombre: u.typologyRef?.name ?? 'Sin tipología', items: [] });
    grupos.get(k)!.items.push(u);
  }

  return (
    <div className="interes">
      {tips.length > 0 && (
        <>
          <label>Tipologías de interés</label>
          <div className="casillas">
            {tips.map((t) => (
              <label key={t.id} className={`casilla ${typologyIds.includes(t.id) ? 'marcada' : ''}`}>
                <input
                  type="checkbox"
                  checked={typologyIds.includes(t.id)}
                  disabled={disabled}
                  onChange={() => onChange({ typologyIds: alternar(typologyIds, t.id), unitIds })}
                />
                <span>
                  <strong>{t.name}</strong>
                  <span className="meta">
                    {[t.bedrooms != null && `${t.bedrooms} dorm`, t.areaM2 && `${t.areaM2} m²`, t.priceFrom && `desde ${precio(t.priceFrom, t.currency)}`]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      {unis.length > 0 && (
        <>
          <label>Unidades de interés</label>
          {[...grupos.entries()].map(([k, g]) => (
            <div key={k} className="grupo-unidades">
              {grupos.size > 1 && <div className="meta grupo-titulo">{g.nombre}</div>}
              <div className="casillas casillas-unidades">
                {g.items.map((u) => (
                  <label
                    key={u.id}
                    className={`casilla casilla-unidad ${unitIds.includes(u.id) ? 'marcada' : ''} ${u.status !== 'disponible' ? 'agotada' : ''}`}
                    title={[u.bedrooms != null && `${u.bedrooms} dorm`, u.areaM2 && `${u.areaM2} m²`, u.price && precio(u.price, u.currency), ESTADO[u.status]]
                      .filter(Boolean).join(' · ')}
                  >
                    <input
                      type="checkbox"
                      checked={unitIds.includes(u.id)}
                      disabled={disabled}
                      onChange={() => onChange({ typologyIds, unitIds: alternar(unitIds, u.id) })}
                    />
                    <span>
                      <strong>{u.code}</strong>
                      {u.price && <span className="meta">{precio(u.price, u.currency)}</span>}
                      {ESTADO[u.status] && <span className="meta">{ESTADO[u.status]}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
