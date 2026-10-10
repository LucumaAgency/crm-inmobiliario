import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';
import { useEtiquetas } from '../lib/vertical.js';

interface Ajustes {
  motivosPerdida: string[];
  descuentoMaximoPct: number | null;
  nivelesInteres: [string, string, string];
  proformaValidezDias: number;
  proformaNota: string;
}

/**
 * Motivos de pérdida y descuento máximo de la organización. Viven en Ajustes → Embudo
 * porque son reglas de cómo se trabaja el embudo, no de un canal.
 */
export default function AjustesEmbudo() {
  const qc = useQueryClient();
  const L = useEtiquetas();
  const ajustes = useQuery({ queryKey: ['ajustes'], queryFn: () => api.get<Ajustes>('/ajustes') });
  const guardar = useMutation({
    mutationFn: (cambios: Partial<Ajustes>) => api.patch('/ajustes', cambios),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ajustes'] });
      qc.invalidateQueries({ queryKey: ['ajustes-operacion'] });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const [nuevo, setNuevo] = useState('');
  const [descuento, setDescuento] = useState('');
  const [niveles, setNiveles] = useState<[string, string, string]>(['', '', '']);
  const [validez, setValidez] = useState('3');
  const [nota, setNota] = useState('');
  useEffect(() => {
    if (ajustes.data) {
      setDescuento(ajustes.data.descuentoMaximoPct == null ? '' : String(ajustes.data.descuentoMaximoPct));
      // Una API anterior a este ajuste no manda la clave: no puede tumbar toda la pantalla.
      setNiveles(ajustes.data.nivelesInteres ?? ['Frío', 'Tibio', 'Caliente']);
      setValidez(String(ajustes.data.proformaValidezDias ?? 3));
      setNota(ajustes.data.proformaNota ?? '');
    }
  }, [ajustes.data]);

  function guardarNiveles() {
    const limpios = niveles.map((n) => n.trim()) as [string, string, string];
    const actuales = ajustes.data?.nivelesInteres ?? ['Frío', 'Tibio', 'Caliente'];
    if (limpios.some((n) => !n)) { setNiveles(actuales); return; }
    if (limpios.join('|') !== actuales.join('|')) guardar.mutate({ nivelesInteres: limpios });
  }

  const motivos: string[] = ajustes.data?.motivosPerdida ?? [];

  function guardarDescuento() {
    const t = descuento.trim();
    const actual = ajustes.data?.descuentoMaximoPct ?? null;
    if (t === '') { if (actual !== null) guardar.mutate({ descuentoMaximoPct: null }); return; }
    const n = Number(t.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0 && n <= 100) {
      if (n !== actual) guardar.mutate({ descuentoMaximoPct: Math.round(n * 100) / 100 });
    } else setDescuento(actual == null ? '' : String(actual));
  }

  return (
    <>
      <div className="card">
        <strong>Motivos de pérdida</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Al mover un lead a una etapa perdida, el asesor elige uno de estos motivos o escribe
          otro. Es obligatorio: un lead desestimado sin razón no enseña nada. Con el tiempo, el
          reporte de motivos dice si se pierde por precio, por zona o por crédito.
        </p>
        <ul className="lista-motivos">
          {motivos.map((m, i) => (
            <li key={m}>
              <span>{m}</span>
              <button
                type="button"
                className="btn btn-sec"
                style={{ padding: '4px 9px', fontSize: 12 }}
                disabled={guardar.isPending}
                onClick={() => guardar.mutate({ motivosPerdida: motivos.filter((_, j) => j !== i) })}
                aria-label={`Quitar ${m}`}
              >
                Quitar
              </button>
            </li>
          ))}
          {motivos.length === 0 && <li className="meta">Sin motivos: el asesor escribirá el suyo cada vez.</li>}
        </ul>
        <form
          className="acciones"
          style={{ marginBottom: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            const t = nuevo.trim();
            if (!t || motivos.includes(t)) return;
            guardar.mutate({ motivosPerdida: [...motivos, t] });
            setNuevo('');
          }}
        >
          <input
            placeholder="Nuevo motivo, p. ej. Prefirió una casa"
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            maxLength={120}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn" disabled={!nuevo.trim() || guardar.isPending}>
            <Icono nombre="mas" tam={15} />Agregar
          </button>
        </form>
        {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
      </div>

      <div className="card">
        <strong>Niveles de interés</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Cómo se llaman los tres niveles que el asesor marca en la ficha, de menor a mayor. Se
          guarda el número, así que cambiar el nombre no toca los leads ya calificados.
        </p>
        <div className="niveles-editor">
          {niveles.map((n, i) => (
            <label key={i} className={`interes-boton interes-${i + 1} activo`} style={{ cursor: 'text' }}>
              <span className="interes-puntos" aria-hidden="true">{'●'.repeat(i + 1)}</span>
              <input
                value={n}
                maxLength={30}
                aria-label={`Nombre del nivel ${i + 1}`}
                onChange={(e) => setNiveles(niveles.map((x, j) => (j === i ? e.target.value : x)) as [string, string, string])}
                onBlur={guardarNiveles}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>{L.documentos}</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Validez y nota legal al pie de cada {L.documento.toLowerCase()}. Los datos de quien emite (razón social,
          RUC, logo) van en cada {L.proyecto.toLowerCase()}, pestaña «Datos para {L.documentos.toLowerCase()}».
        </p>
        <div className="rejilla-2">
          <div>
            <label htmlFor="pf-dias">Días de validez</label>
            <input
              id="pf-dias"
              inputMode="numeric"
              value={validez}
              onChange={(e) => setValidez(e.target.value)}
              onBlur={() => { const n = Number(validez); if (Number.isInteger(n) && n >= 1 && n <= 90 && n !== ajustes.data?.proformaValidezDias) guardar.mutate({ proformaValidezDias: n }); else setValidez(String(ajustes.data?.proformaValidezDias ?? 3)); }}
              style={{ width: 90 }}
            />
          </div>
        </div>
        <label htmlFor="pf-nota">Nota al pie</label>
        <textarea
          id="pf-nota"
          rows={3}
          value={nota}
          maxLength={1000}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => { if (nota.trim() && nota.trim() !== ajustes.data?.proformaNota) guardar.mutate({ proformaNota: nota.trim() }); }}
        />
        <p className="meta">Se guarda al salir del campo. Al final se agrega sola la fecha de vencimiento.</p>
      </div>

      <div className="card">
        <strong>Descuentos</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          Tope de descuento (%) que un asesor puede ofrecer en una {L.documento.toLowerCase()} si no tiene uno
          propio en Usuarios. Vacío = sin tope. Los precios de lista los cambia solo gerencia,
          y cada cambio queda en el registro de auditoría.
        </p>
        <label htmlFor="desc-org">Descuento máximo de la organización</label>
        <span className="porcentaje">
          <input
            id="desc-org"
            type="text"
            inputMode="decimal"
            value={descuento}
            placeholder="sin tope"
            onChange={(e) => setDescuento(e.target.value)}
            onBlur={guardarDescuento}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            style={{ width: 90, textAlign: 'right' }}
          />
          <span className="meta">%</span>
        </span>
      </div>
    </>
  );
}
