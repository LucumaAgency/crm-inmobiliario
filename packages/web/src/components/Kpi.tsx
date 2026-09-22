import Icono, { type NombreIcono } from './Icono.js';

export interface KpiProps {
  titulo: string;
  icono: NombreIcono;
  tono?: '' | 'navy' | 'solido' | 'ambar';
  valor: string;
  unidad?: string;
  /** Variación ya formateada y su lectura (buena o mala). */
  delta?: { texto: string; tono: 'sube' | 'baja' | '' };
  nota?: string;
}

export function KpiContenido({ titulo, icono, tono = '', valor, unidad, delta, nota }: KpiProps) {
  return (
    <>
      <div className="kpi-cab">
        <span className={`kpi-icono ${tono}`}><Icono nombre={icono} tam={14} /></span>
        {titulo}
      </div>
      <div className="kpi-valor">
        {valor}
        {unidad && <small>{unidad}</small>}
      </div>
      <div className="kpi-delta">
        {delta && (
          <>
            {/* El signo y la flecha llevan la lectura: el color solo la refuerza. */}
            <b className={delta.tono}>
              {delta.tono === 'sube' && <Icono nombre="subir" tam={11} />}
              {delta.tono === 'baja' && <Icono nombre="bajar" tam={11} />}
              {delta.texto}
            </b>
            <span className="vs">vs período anterior</span>
          </>
        )}
        {!delta && nota && <span>{nota}</span>}
      </div>
    </>
  );
}

export default function Kpi(props: KpiProps) {
  return (
    <div className="kpi">
      <KpiContenido {...props} />
    </div>
  );
}
