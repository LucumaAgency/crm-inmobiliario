/**
 * Nivel de interés del lead, en tres niveles.
 *
 * Es el juicio del asesor después de hablar con la persona, no un cálculo. Tres niveles y no
 * cinco porque en caseta se decide rápido. Los NOMBRES los pone cada organización en Ajustes →
 * Embudo (frío/tibio/caliente, bajo/medio/alto, C/B/A...); lo que se guarda es el número.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

export interface AjustesOperacion { motivosPerdida: string[]; nivelesInteres: [string, string, string] }

const PUNTOS: Record<number, string> = { 1: '●', 2: '●●', 3: '●●●' };
const POR_DEFECTO: [string, string, string] = ['Frío', 'Tibio', 'Caliente'];

/** Ajustes que cualquier rol necesita para operar; se cachean 5 min. */
export function useAjustesOperacion() {
  return useQuery({
    queryKey: ['ajustes-operacion'],
    queryFn: () => api.get<AjustesOperacion>('/ajustes/operacion'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useNivelesInteres(): [string, string, string] {
  const q = useAjustesOperacion();
  return q.data?.nivelesInteres ?? POR_DEFECTO;
}

export function ChipInteres({ nivel, compacto = false }: { nivel: number | null | undefined; compacto?: boolean }) {
  const nombres = useNivelesInteres();
  if (!nivel || nivel < 1 || nivel > 3) return null;
  const texto = nombres[nivel - 1]!;
  return (
    <span className={`interes interes-${nivel}`} title={`Interés: ${texto}`}>
      <span className="interes-puntos" aria-hidden="true">{PUNTOS[nivel]}</span>
      {!compacto && texto}
    </span>
  );
}

/** Botones para fijar el nivel. `null` lo quita. */
export function SelectorInteres({
  valor,
  onChange,
  disabled,
}: {
  valor: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
}) {
  const nombres = useNivelesInteres();
  return (
    <div className="interes-selector" role="radiogroup" aria-label="Nivel de interés">
      {[1, 2, 3].map((n) => {
        const activo = valor === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={activo}
            className={`interes-boton interes-${n} ${activo ? 'activo' : ''}`}
            disabled={disabled}
            onClick={() => onChange(activo ? null : n)}
          >
            <span className="interes-puntos" aria-hidden="true">{PUNTOS[n]}</span>
            {nombres[n - 1]}
          </button>
        );
      })}
    </div>
  );
}
