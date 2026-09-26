import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import ImportarUnidades from './ImportarUnidades.js';

interface Tipologia {
  id: string;
  name: string;
  code: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: string | null;
  priceFrom: string | null;
  currency: string;
  description: string | null;
  planUrl: string | null;
  imageUrl: string | null;
  active: boolean;
  _count?: { units: number };
}

interface Unidad {
  id: string;
  code: string;
  typologyId: string | null;
  typologyRef: { id: string; name: string } | null;
  kind: string;
  status: string;
  bedrooms: number | null;
  areaM2: string | null;
  price: string | null;
  currency: string;
  floor: number | null;
}

const ESTADOS: Record<string, string> = {
  disponible: 'Disponible',
  reservado: 'Reservado',
  vendido: 'Vendido',
  no_disponible: 'No disponible',
};

const TIPOS: Record<string, string> = {
  departamento: 'Departamento',
  estacionamiento: 'Estacionamiento',
  deposito: 'Depósito',
  lote: 'Lote',
  oficina: 'Oficina',
  otro: 'Otro',
};

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

export default function ProyectoDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [pestana, setPestana] = useState<'tipologias' | 'unidades'>('tipologias');
  const [importando, setImportando] = useState(false);

  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });
  const proyecto = proyectos.data?.find((p) => p.id === id);

  const tipologias = useQuery({
    queryKey: ['typologies', id],
    queryFn: () => api.get<Tipologia[]>(`/projects/${id}/typologies`),
  });
  const unidades = useQuery({
    queryKey: ['units', id],
    queryFn: () => api.get<Unidad[]>(`/projects/${id}/units`),
  });

  const refrescar = () => {
    qc.invalidateQueries({ queryKey: ['typologies', id] });
    qc.invalidateQueries({ queryKey: ['units', id] });
  };

  // ---------------------------------------------------------- tipologías
  const [tNombre, setTNombre] = useState('');
  const [tDorm, setTDorm] = useState('');
  const [tBanos, setTBanos] = useState('');
  const [tArea, setTArea] = useState('');
  const [tPrecio, setTPrecio] = useState('');
  const [tDesc, setTDesc] = useState('');

  const crearTipologia = useMutation({
    mutationFn: () =>
      api.post(`/projects/${id}/typologies`, {
        name: tNombre.trim(),
        bedrooms: num(tDorm),
        bathrooms: num(tBanos),
        areaM2: num(tArea),
        priceFrom: num(tPrecio),
        description: tDesc.trim() || undefined,
      }),
    onSuccess: () => {
      refrescar();
      setTNombre(''); setTDorm(''); setTBanos(''); setTArea(''); setTPrecio(''); setTDesc('');
    },
  });

  const [subiendo, setSubiendo] = useState<string | null>(null);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);

  /**
   * Sube un archivo a una tipología.
   *
   * No usa el helper de la API porque va como multipart y no como JSON: el helper fija
   * `Content-Type: application/json`, que rompería el envío.
   */
  const subir = async (tipologiaId: string, campo: 'planUrl' | 'imageUrl', archivo: File) => {
    setErrorSubida(null);
    setSubiendo(`${tipologiaId}:${campo}`);
    try {
      const datos = new FormData();
      datos.append('archivo', archivo);
      const res = await fetch(`/api/v1/typologies/${tipologiaId}/media?campo=${campo}`, {
        method: 'POST',
        credentials: 'same-origin',
        body: datos,
      });
      if (!res.ok) {
        const cuerpo = await res.json().catch(() => ({}));
        throw new Error(cuerpo.error ?? `Error ${res.status}`);
      }
      refrescar();
    } catch (err) {
      setErrorSubida((err as Error).message);
    } finally {
      setSubiendo(null);
    }
  };

  const borrarTipologia = useMutation({
    mutationFn: (t: Tipologia) => api.del<{ unidadesSinTipologia: number }>(`/typologies/${t.id}`),
    onSuccess: refrescar,
  });

  // ------------------------------------------------------------ unidades
  const [uCodigo, setUCodigo] = useState('');
  const [uTip, setUTip] = useState('');
  const [uPiso, setUPiso] = useState('');
  const [uPrecio, setUPrecio] = useState('');
  const [uTipo, setUTipo] = useState('departamento');

  const crearUnidad = useMutation({
    mutationFn: () =>
      api.post(`/projects/${id}/units`, {
        code: uCodigo.trim(),
        typologyId: uTip || undefined,
        kind: uTipo,
        floor: num(uPiso),
        price: num(uPrecio),
      }),
    onSuccess: () => { refrescar(); setUCodigo(''); setUPiso(''); setUPrecio(''); },
  });

  const cambiarUnidad = useMutation({
    mutationFn: (v: { id: string; status?: string; typologyId?: string }) =>
      api.patch(`/units/${v.id}`, v),
    onSuccess: refrescar,
  });

  const porEstado = (unidades.data ?? []).reduce<Record<string, number>>((acc, u) => {
    acc[u.status] = (acc[u.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="barra-acciones">
        <div style={{ flex: 1 }}>
          <Link to="/proyectos" className="meta">← Proyectos</Link>
          <h2 style={{ margin: '4px 0 0', fontSize: 20 }}>{proyecto?.name ?? 'Proyecto'}</h2>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{tipologias.data?.length ?? '—'}</div><div className="t">Tipologías</div></div>
        <div className="stat"><div className="n">{unidades.data?.length ?? '—'}</div><div className="t">Unidades</div></div>
        <div className="stat"><div className="n">{porEstado.disponible ?? 0}</div><div className="t">Disponibles</div></div>
        <div className="stat"><div className="n">{porEstado.vendido ?? 0}</div><div className="t">Vendidas</div></div>
      </div>

      <div className="pestanas">
        <button type="button" className={pestana === 'tipologias' ? 'activa' : ''} onClick={() => setPestana('tipologias')}>
          Tipologías
        </button>
        <button type="button" className={pestana === 'unidades' ? 'activa' : ''} onClick={() => setPestana('unidades')}>
          Unidades
        </button>
      </div>

      {pestana === 'tipologias' && (
        <>
          <div className="card">
            <strong>Tipologías del proyecto</strong>
            <p className="meta" style={{ marginTop: 4 }}>
              El modelo que se vende. Las unidades apuntan a una tipología, así que se define
              una sola vez y no depende de escribir el mismo texto en cada unidad.
            </p>

            {errorSubida && <p className="error">{errorSubida}</p>}

            {tipologias.data?.length === 0 && (
              <div className="vacio">Aún no hay tipologías. Crea la primera abajo.</div>
            )}

            {(tipologias.data?.length ?? 0) > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Nombre</th><th>Dorm.</th><th>Área</th><th>Desde</th><th>Unidades</th><th>Plano</th><th>Render</th><th></th></tr>
                  </thead>
                  <tbody>
                    {tipologias.data?.map((t) => (
                      <tr key={t.id}>
                        <td className="t-titulo">{t.name}</td>
                        <td data-label="Dormitorios">{t.bedrooms ?? '—'}</td>
                        <td data-label="Área">{t.areaM2 ? `${t.areaM2} m²` : '—'}</td>
                        <td data-label="Desde">{t.priceFrom ? `${t.currency} ${t.priceFrom}` : '—'}</td>
                        <td data-label="Unidades">{t._count?.units ?? 0}</td>
                        <td data-label="Plano"><Archivo t={t} campo="planUrl" etiqueta="plano" subiendo={subiendo} subir={subir} /></td>
                        <td data-label="Render"><Archivo t={t} campo="imageUrl" etiqueta="render" subiendo={subiendo} subir={subir} /></td>
                        <td className="accion">
                          <button
                            type="button"
                            className="btn btn-sec"
                            disabled={borrarTipologia.isPending}
                            onClick={() => {
                              const n = t._count?.units ?? 0;
                              const aviso = n
                                ? `${t.name} tiene ${n} unidad(es). No se borran: quedarán sin tipología. ¿Continuar?`
                                : `¿Borrar ${t.name}?`;
                              if (confirm(aviso)) borrarTipologia.mutate(t);
                            }}
                          >
                            Borrar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <strong>Nueva tipología</strong>
            <form
              onSubmit={(e) => { e.preventDefault(); if (tNombre.trim()) crearTipologia.mutate(); }}
            >
              <label htmlFor="t-nombre">Nombre *</label>
              <input id="t-nombre" value={tNombre} placeholder="Tipo B · 3 dormitorios" onChange={(e) => setTNombre(e.target.value)} />
              <div className="rejilla-2">
                <div>
                  <label htmlFor="t-dorm">Dormitorios</label>
                  <input id="t-dorm" inputMode="numeric" value={tDorm} onChange={(e) => setTDorm(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="t-banos">Baños</label>
                  <input id="t-banos" inputMode="numeric" value={tBanos} onChange={(e) => setTBanos(e.target.value)} />
                </div>
              </div>
              <div className="rejilla-2">
                <div>
                  <label htmlFor="t-area">Área (m²)</label>
                  <input id="t-area" inputMode="decimal" value={tArea} onChange={(e) => setTArea(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="t-precio">Precio desde</label>
                  <input id="t-precio" inputMode="decimal" value={tPrecio} onChange={(e) => setTPrecio(e.target.value)} />
                </div>
              </div>
              <label htmlFor="t-desc">Descripción</label>
              <textarea id="t-desc" rows={2} value={tDesc} onChange={(e) => setTDesc(e.target.value)} />
              {crearTipologia.isError && <p className="error">{(crearTipologia.error as Error).message}</p>}
              <div className="acciones">
                <button type="submit" className="btn" disabled={!tNombre.trim() || crearTipologia.isPending}>
                  {crearTipologia.isPending ? 'Guardando…' : 'Añadir tipología'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {pestana === 'unidades' && (
        <>
          {importando && (
            <ImportarUnidades
              projectId={id}
              onCerrar={() => setImportando(false)}
              onImportado={refrescar}
            />
          )}

          <div className="card">
            <div className="fila">
              <strong>Unidades</strong>
              <button type="button" className="btn btn-sec" onClick={() => setImportando(true)}>
                Importar CSV
              </button>
            </div>
            {unidades.data?.length === 0 && (
              <div className="vacio">Aún no hay unidades. Crea primero las tipologías y luego añádelas.</div>
            )}
            {(unidades.data?.length ?? 0) > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table className="tabla tabla-movil" style={{ marginTop: 10 }}>
                  <thead>
                    <tr><th>Código</th><th>Tipología</th><th>Piso</th><th>Precio</th><th>Tipo</th><th>Estado</th></tr>
                  </thead>
                  <tbody>
                    {unidades.data?.map((u) => (
                      <tr key={u.id}>
                        <td className="t-titulo">Unidad {u.code}</td>
                        <td className="ancho" data-label="Tipología">
                          <select
                            value={u.typologyId ?? ''}
                            onChange={(e) => cambiarUnidad.mutate({ id: u.id, typologyId: e.target.value })}
                          >
                            <option value="">— sin tipología —</option>
                            {tipologias.data?.map((t) => (
                              <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                          </select>
                        </td>
                        <td data-label="Piso">{u.floor ?? '—'}</td>
                        <td data-label="Precio">{u.price ? `${u.currency} ${u.price}` : '—'}</td>
                        <td data-label="Tipo">{TIPOS[u.kind] ?? u.kind}</td>
                        <td data-label="Estado">
                          <select
                            value={u.status}
                            onChange={(e) => cambiarUnidad.mutate({ id: u.id, status: e.target.value })}
                          >
                            {Object.entries(ESTADOS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <strong>Nueva unidad</strong>
            <form onSubmit={(e) => { e.preventDefault(); if (uCodigo.trim()) crearUnidad.mutate(); }}>
              <div className="rejilla-2">
                <div>
                  <label htmlFor="u-codigo">Código *</label>
                  <input id="u-codigo" value={uCodigo} placeholder="601" onChange={(e) => setUCodigo(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="u-tip">Tipología</label>
                  <select id="u-tip" value={uTip} onChange={(e) => setUTip(e.target.value)}>
                    <option value="">— sin tipología —</option>
                    {tipologias.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="rejilla-2">
                <div>
                  <label htmlFor="u-piso">Piso</label>
                  <input id="u-piso" inputMode="numeric" value={uPiso} onChange={(e) => setUPiso(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="u-precio">Precio</label>
                  <input id="u-precio" inputMode="decimal" value={uPrecio} onChange={(e) => setUPrecio(e.target.value)} />
                </div>
              </div>
              <label htmlFor="u-tipo">Tipo</label>
              <select id="u-tipo" value={uTipo} onChange={(e) => setUTipo(e.target.value)}>
                {Object.entries(TIPOS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              {crearUnidad.isError && <p className="error">{(crearUnidad.error as Error).message}</p>}
              <div className="acciones">
                <button type="submit" className="btn" disabled={!uCodigo.trim() || crearUnidad.isPending}>
                  {crearUnidad.isPending ? 'Guardando…' : 'Añadir unidad'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}

/** Celda de plano o render: muestra el archivo si existe y permite reemplazarlo. */
function Archivo({
  t,
  campo,
  etiqueta,
  subiendo,
  subir,
}: {
  t: Tipologia;
  campo: 'planUrl' | 'imageUrl';
  etiqueta: string;
  subiendo: string | null;
  subir: (id: string, campo: 'planUrl' | 'imageUrl', archivo: File) => void;
}) {
  const url = t[campo];
  const cargando = subiendo === `${t.id}:${campo}`;
  const idInput = `f-${t.id}-${campo}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" title={`Ver ${etiqueta}`}>
          {url.endsWith('.pdf') ? 'PDF' : (
            <img src={url} alt={etiqueta} style={{ width: 30, height: 30, objectFit: 'cover', borderRadius: 4, display: 'block' }} />
          )}
        </a>
      )}
      <label htmlFor={idInput} className="btn btn-sec" style={{ padding: '4px 8px', fontSize: 12, cursor: 'pointer' }}>
        {cargando ? '…' : url ? 'Cambiar' : 'Subir'}
      </label>
      <input
        id={idInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        style={{ display: 'none' }}
        disabled={cargando}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) subir(t.id, campo, f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
