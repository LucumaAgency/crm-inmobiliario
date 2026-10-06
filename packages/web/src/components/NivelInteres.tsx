/**
 * Nivel de interés del lead: frío, tibio, caliente.
 *
 * Es el juicio del asesor después de hablar con la persona, no un cálculo. Tres niveles y no
 * cinco porque en caseta se decide rápido y «4 de 5» no significa nada para nadie; «caliente»
 * sí: hay que llamarlo hoy.
 */
export const NIVELES: Record<number, { texto: string; clase: string; icono: string }> = {
  1: { texto: 'Frío', clase: 'interes interes-1', icono: '●' },
  2: { texto: 'Tibio', clase: 'interes interes-2', icono: '●●' },
  3: { texto: 'Caliente', clase: 'interes interes-3', icono: '●●●' },
};

export function ChipInteres({ nivel, compacto = false }: { nivel: number | null | undefined; compacto?: boolean }) {
  if (!nivel || !NIVELES[nivel]) return null;
  const n = NIVELES[nivel]!;
  return (
    <span className={n.clase} title={`Interés ${n.texto.toLowerCase()}`}>
      <span className="interes-puntos" aria-hidden="true">{n.icono}</span>
      {!compacto && n.texto}
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
  return (
    <div className="interes-selector" role="radiogroup" aria-label="Nivel de interés">
      {[1, 2, 3].map((n) => {
        const d = NIVELES[n]!;
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
            <span className="interes-puntos" aria-hidden="true">{d.icono}</span>
            {d.texto}
          </button>
        );
      })}
    </div>
  );
}
