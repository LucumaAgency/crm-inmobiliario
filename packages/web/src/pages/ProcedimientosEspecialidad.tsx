import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from '../components/Icono.js';

interface Procedimiento {
  id: string;
  code: string;
  price: string | null;
  currency: string;
  extra: { orden?: number; desde?: boolean; cirugia?: boolean; nota?: string | null } | null;
}

const aNumero = (t: string) => (t.trim() ? Number(t.replace(/\./g, '').replace(',', '.')) : null);

/**
 * Procedimientos de una especialidad (vertical clínica, docs/29).
 *
 * Misma tabla `units` que los departamentos y los paquetes: `code` es el nombre del
 * procedimiento, `price` el precio y en `extra` van «desde», si es cirugía y una nota de qué
 * incluye. «Cirugía» es lo que decide el cobro por paciente: solo se cobra la atención que fue
 * cirugía (y llegó por canales de Lucuma).
 */
export default function ProcedimientosEspecialidad({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const procs = useQuery({ queryKey: ['units', projectId], queryFn: () => api.get<Procedimiento[]>(`/projects/${projectId}/units`) });
  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['units', projectId] });
    qc.invalidateQueries({ queryKey: ['catalogo-unidades'] });
  };

  const [nombre, setNombre] = useState('');
  const [precioN, setPrecioN] = useState('');
  const [desde, setDesde] = useState(false);
  const [cirugia, setCirugia] = useState(false);
  const [nota, setNota] = useState('');

  const crear = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/units`, {
        code: nombre.trim(),
        kind: 'otro',
        status: 'disponible',
        price: aNumero(precioN) ?? undefined,
        currency: 'PEN',
        extra: { desde, cirugia, nota: nota.trim() || null, orden: (procs.data?.length ?? 0) + 1 },
      }),
    onSuccess: () => { setNombre(''); setPrecioN(''); setDesde(false); setCirugia(false); setNota(''); refrescar(); },
  });
  const cambiar = useMutation({
    mutationFn: (v: { id: string; datos: Record<string, unknown> }) => api.patch(`/units/${v.id}`, v.datos),
    onSuccess: refrescar,
  });

  const lista = (procs.data ?? []).slice().sort((a, b) => (a.extra?.orden ?? 99) - (b.extra?.orden ?? 99) || a.code.localeCompare(b.code));

  return (
    <>
      <div className="card">
        <strong>Procedimientos</strong>
        <p className="meta" style={{ marginTop: 4 }}>
          Lo que informas a tus pacientes, con su precio. «Desde» indica que el precio final se
          define en consulta. Marca cuáles son cirugía: al pasar un paciente a «Atendido» eliges
          qué se le hizo.
        </p>
        {procs.data?.length === 0 && <div className="vacio">Sin procedimientos. Crea el primero abajo.</div>}
        {lista.length > 0 && (
          <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
            <thead><tr><th>Procedimiento</th><th>Precio (S/)</th><th>Desde</th><th>Cirugía</th><th>Qué incluye</th></tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="t-titulo">{p.code}</td>
                  <td data-label="Precio (S/)">
                    <input
                      inputMode="decimal"
                      defaultValue={p.price ? String(Number(p.price)) : ''}
                      placeholder="—"
                      aria-label={`Precio de ${p.code}`}
                      style={{ width: 100, margin: 0, padding: '5px 7px' }}
                      onBlur={(e) => {
                        const n = aNumero(e.target.value);
                        if (n !== (p.price ? Number(p.price) : null)) cambiar.mutate({ id: p.id, datos: { price: n } });
                      }}
                    />
                  </td>
                  <td data-label="Desde">
                    <input type="checkbox" aria-label={`Precio desde en ${p.code}`} checked={p.extra?.desde ?? false}
                      onChange={(e) => cambiar.mutate({ id: p.id, datos: { extra: { desde: e.target.checked } } })} />
                  </td>
                  <td data-label="Cirugía">
                    <input type="checkbox" aria-label={`${p.code} es cirugía`} checked={p.extra?.cirugia ?? false}
                      onChange={(e) => cambiar.mutate({ id: p.id, datos: { extra: { cirugia: e.target.checked } } })} />
                  </td>
                  <td data-label="Qué incluye" className="ancho">
                    <input
                      defaultValue={p.extra?.nota ?? ''}
                      placeholder="Opcional"
                      aria-label={`Qué incluye ${p.code}`}
                      style={{ width: '100%', margin: 0, padding: '5px 7px' }}
                      onBlur={(e) => {
                        const t = e.target.value.trim() || null;
                        if (t !== (p.extra?.nota ?? null)) cambiar.mutate({ id: p.id, datos: { extra: { nota: t } } });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {cambiar.isError && <p className="error">{(cambiar.error as Error).message}</p>}
      </div>

      <div className="card">
        <strong>Nuevo procedimiento</strong>
        <form onSubmit={(e) => { e.preventDefault(); if (nombre.trim()) crear.mutate(); }}>
          <div className="rejilla-2">
            <div><label htmlFor="pr-nombre">Nombre *</label><input id="pr-nombre" value={nombre} placeholder="Tiroidectomía total" onChange={(e) => setNombre(e.target.value)} /></div>
            <div><label htmlFor="pr-precio">Precio (S/)</label><input id="pr-precio" inputMode="decimal" value={precioN} placeholder="8500" onChange={(e) => setPrecioN(e.target.value)} /></div>
          </div>
          <div className="rejilla-2">
            <label className="casilla" style={{ margin: 0 }}><input type="checkbox" checked={cirugia} onChange={(e) => setCirugia(e.target.checked)} /><span><strong>Es cirugía</strong><span className="meta">no marcar en consultas ni controles</span></span></label>
            <label className="casilla" style={{ margin: 0 }}><input type="checkbox" checked={desde} onChange={(e) => setDesde(e.target.checked)} /><span><strong>Precio «desde»</strong><span className="meta">el final se define en consulta</span></span></label>
          </div>
          <label htmlFor="pr-nota">Qué incluye</label>
          <input id="pr-nota" value={nota} placeholder="Honorarios del cirujano; no incluye clínica ni anestesia." onChange={(e) => setNota(e.target.value)} />
          {crear.isError && <p className="error">{(crear.error as Error).message}</p>}
          <div className="acciones">
            <button type="submit" className="btn" disabled={!nombre.trim() || crear.isPending}><Icono nombre="mas" tam={14} />{crear.isPending ? 'Guardando…' : 'Añadir procedimiento'}</button>
          </div>
        </form>
      </div>
    </>
  );
}
