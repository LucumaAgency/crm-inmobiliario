import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Proyecto {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  address: string | null;
  active: boolean;
}

/** El slug va en la URL y en los formularios: se propone, no se escribe a mano. */
function aSlug(texto: string) {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default function Proyectos() {
  const qc = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTocado, setSlugTocado] = useState(false);
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');

  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Proyecto[]>('/projects'),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post<Proyecto>('/projects', {
        name: name.trim(),
        slug: slug.trim(),
        code: code.trim() || undefined,
        address: address.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setCreando(false);
      setName(''); setSlug(''); setSlugTocado(false); setCode(''); setAddress('');
    },
  });

  const invalido = !name.trim() || !/^[a-z0-9-]+$/.test(slug.trim());

  return (
    <>
      <div className="barra-acciones">
        <h2 style={{ flex: 1, margin: 0, fontSize: 20 }}>Proyectos</h2>
        <button type="button" className="btn" onClick={() => setCreando(true)}>+ Nuevo proyecto</button>
      </div>

      {proyectos.isLoading && <div className="vacio">Cargando…</div>}
      {proyectos.data?.length === 0 && (
        <div className="vacio">
          Todavía no hay proyectos. Crea el primero para cargar sus tipologías y unidades.
        </div>
      )}

      {proyectos.data?.map((p) => (
        <Link key={p.id} to={`/proyectos/${p.id}`} className="card card-lead">
          <div className="fila">
            <span className="nombre">{p.name}</span>
            {!p.active && <span className="chip chip-gris">inactivo</span>}
          </div>
          <div className="meta" style={{ marginTop: 4 }}>
            {[p.code, p.address, `/${p.slug}`].filter(Boolean).join(' · ')}
          </div>
        </Link>
      ))}

      {creando && (
        <div className="modal-fondo" onClick={() => setCreando(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-cab">
              <h2>Nuevo proyecto</h2>
              <button type="button" className="cerrar" onClick={() => setCreando(false)} aria-label="Cerrar">×</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!invalido) crear.mutate();
              }}
            >
              <label htmlFor="p-name">Nombre *</label>
              <input
                id="p-name"
                value={name}
                autoFocus
                placeholder="Edificio Domus"
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTocado) setSlug(aSlug(e.target.value));
                }}
              />

              <label htmlFor="p-slug">Identificador *</label>
              <input
                id="p-slug"
                value={slug}
                onChange={(e) => { setSlugTocado(true); setSlug(aSlug(e.target.value)); }}
              />
              <p className="meta">Solo minúsculas, números y guiones. Se propone desde el nombre.</p>

              <div className="rejilla-2">
                <div>
                  <label htmlFor="p-code">Código interno</label>
                  <input id="p-code" value={code} onChange={(e) => setCode(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="p-address">Dirección</label>
                  <input id="p-address" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
              </div>

              {crear.isError && <p className="error">{(crear.error as Error).message}</p>}

              <div className="acciones" style={{ marginTop: 16 }}>
                <button type="submit" className="btn" disabled={invalido || crear.isPending}>
                  {crear.isPending ? 'Creando…' : 'Crear proyecto'}
                </button>
                <button type="button" className="btn btn-sec" onClick={() => setCreando(false)}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
