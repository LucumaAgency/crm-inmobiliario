import { useEffect, useRef, useState } from 'react';

export interface PuntoSerie {
  fecha: string; // YYYY-MM-DD
  actual: number;
  previo: number;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fechaCorta(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MESES[m! - 1]}`;
}

/** Tope del eje: redondeado hacia arriba a un número que se lee de un vistazo. */
function topeLegible(max: number) {
  if (max <= 4) return 4;
  const paso = max <= 20 ? 4 : max <= 60 ? 10 : max <= 200 ? 20 : 100;
  return Math.ceil(max / paso) * paso;
}

/**
 * Matriz de puntos: cada columna es un día y cada celda una fracción del tope.
 * Azul = período actual; gris = el mismo día del período anterior, detrás.
 *
 * Es un gráfico de barras con otra textura: la altura sigue siendo la magnitud, así que
 * se lee igual, pero la rejilla deja ver el hueco que falta hasta el tope.
 */
export default function MatrizPuntos({
  serie,
  etiqueta,
  etiquetaPrevio = 'Período anterior',
  filas = 14,
}: {
  serie: PuntoSerie[];
  etiqueta: string;
  etiquetaPrevio?: string;
  filas?: number;
}) {
  const [activo, setActivo] = useState<number | null>(null);
  const [comoTabla, setComoTabla] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [ancho, setAncho] = useState(800);

  // Cuántas fechas caben depende del ancho real: en el celular son la mitad.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setAncho(e!.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, [comoTabla]);

  const tope = topeLegible(Math.max(1, ...serie.map((p) => Math.max(p.actual, p.previo))));
  const celdas = (v: number) => (v <= 0 ? 0 : Math.max(1, Math.round((v / tope) * filas)));

  // Etiquetas de fecha espaciadas y contadas desde hoy: la última siempre sale y ninguna choca.
  const caben = Math.max(2, Math.floor(ancho / 72));
  const cada = Math.max(1, Math.ceil(serie.length / caben));
  const conFecha = (i: number) => (serie.length - 1 - i) % cada === 0;

  const punto = activo !== null ? serie[activo] : null;
  // El tooltip se ancla a la cima de la columna activa, a su derecha (o izquierda si no cabe).
  let tip = { x: 0, y: 0, izq: false };
  if (activo !== null && punto && areaRef.current && colRefs.current[activo]) {
    const area = areaRef.current.getBoundingClientRect();
    const col = colRefs.current[activo]!.getBoundingClientRect();
    const x = col.left - area.left + col.width / 2;
    const alto = Math.max(celdas(punto.actual), celdas(punto.previo)) / filas;
    tip = {
      x,
      y: Math.max(col.height * (1 - alto), 36),
      izq: x > area.width - 170,
    };
  }

  if (comoTabla) {
    return (
      <>
        <div className="tabla-scroll" style={{ maxHeight: 260, overflowY: 'auto' }}>
          <table className="tabla">
            <thead>
              <tr><th>Fecha</th><th>{etiqueta}</th><th>{etiquetaPrevio}</th></tr>
            </thead>
            <tbody>
              {serie.map((p) => (
                <tr key={p.fecha}><td>{fechaCorta(p.fecha)}</td><td>{p.actual}</td><td>{p.previo}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sec" style={{ marginTop: 10 }} onClick={() => setComoTabla(false)}>
          Ver gráfico
        </button>
      </>
    );
  }

  return (
    <>
      <div className="matriz">
        <div className="matriz-eje" aria-hidden="true">
          {[1, 0.75, 0.5, 0.25, 0].map((f) => (
            <span key={f}>{Math.round(tope * f)}</span>
          ))}
        </div>
        <div className="matriz-area" ref={areaRef} style={{ position: 'relative' }}>
          <div className="matriz-cols" role="list" aria-label={`${etiqueta} por día`}>
            {serie.map((p, i) => {
              const nAct = celdas(p.actual);
              const nPrev = celdas(p.previo);
              return (
                <div
                  key={p.fecha}
                  ref={(el) => { colRefs.current[i] = el; }}
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${fechaCorta(p.fecha)}: ${p.actual} ${etiqueta.toLowerCase()}, ${p.previo} en el período anterior`}
                  className={`matriz-col${activo === i ? ' activa' : ''}`}
                  onPointerEnter={() => setActivo(i)}
                  onPointerLeave={() => setActivo(null)}
                  onFocus={() => setActivo(i)}
                  onBlur={() => setActivo(null)}
                >
                  {Array.from({ length: filas }, (_, f) => (
                    <span
                      key={f}
                      className={`celda${f < nAct ? ' act' : f < nPrev ? ' prev' : ''}`}
                    />
                  ))}
                </div>
              );
            })}
          </div>
          <div className="matriz-fechas" aria-hidden="true">
            {serie.map((p, i) => (
              <span key={p.fecha}>{conFecha(i) && <em>{fechaCorta(p.fecha)}</em>}</span>
            ))}
          </div>

          {punto && (
            <div className={`tooltip${tip.izq ? ' izq' : ''}`} style={{ left: tip.x, top: tip.y }}>
              <div className="t-fecha">{fechaCorta(punto.fecha)}</div>
              <div className="t-fila">
                <i style={{ background: 'var(--azul)' }} /><b>{punto.actual}</b>{etiqueta}
              </div>
              <div className="t-fila">
                <i style={{ background: '#B7C3D6' }} /><b>{punto.previo}</b>{etiquetaPrevio}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="fila" style={{ marginTop: 12 }}>
        <div className="leyenda">
          <span><i style={{ background: 'var(--azul)' }} />{etiqueta}</span>
          <span><i style={{ background: '#D5DDEA' }} />{etiquetaPrevio}</span>
        </div>
        <button
          type="button"
          className="btn btn-sec"
          style={{ padding: '5px 10px', fontSize: 12 }}
          onClick={() => setComoTabla(true)}
        >
          Ver tabla
        </button>
      </div>
    </>
  );
}
