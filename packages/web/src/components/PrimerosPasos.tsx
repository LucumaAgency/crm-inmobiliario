/**
 * Primeros pasos: un asistente que se abre solo la primera vez que alguien entra, y una
 * tarjeta en Resumen con el avance. Qué falta lo decide el servidor mirando los datos
 * (routes/primeros-pasos.ts): si ya hay tipologías, ese paso está hecho.
 */
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Icono from './Icono.js';

export interface Paso {
  id: string;
  titulo: string;
  texto: string;
  enlace: string;
  accion: string;
  hecho: boolean;
  opcional?: boolean;
}

export interface DatosPrimerosPasos {
  vertical: string;
  pasos: Paso[];
  completados: number;
  total: number;
  abrirAsistente: boolean;
  oculto: boolean;
}

export function usePrimerosPasos() {
  return useQuery({
    queryKey: ['primeros-pasos'],
    queryFn: () => api.get<DatosPrimerosPasos>('/primeros-pasos'),
    // Se vuelve a mirar al regresar a la pestaña: el paso se hace en otra pantalla.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

function useAccion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (accion: 'visto' | 'ocultar' | 'mostrar') => api.post('/primeros-pasos', { accion }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['primeros-pasos'] }),
  });
}

/** Para abrir el asistente desde cualquier parte (menú de usuario, tarjeta de Resumen). */
export const AbrirGuiaContext = createContext<() => void>(() => {});
export function useAbrirGuia() {
  return useContext(AbrirGuiaContext);
}

function Estado({ paso }: { paso: Paso }) {
  if (paso.hecho) return <span className="chip chip-verde">Hecho</span>;
  if (paso.opcional) return <span className="chip chip-gris">Opcional</span>;
  return <span className="chip chip-alerta">Pendiente</span>;
}

/** El asistente: bienvenida, un paso por pantalla y cierre. */
export function AsistentePrimerosPasos({ datos, onCerrar }: { datos: DatosPrimerosPasos; onCerrar: () => void }) {
  const navigate = useNavigate();
  const accion = useAccion();
  // Empieza en el primer paso pendiente si ya hubo avance; si no, en la bienvenida.
  const primeroPendiente = datos.pasos.findIndex((p) => !p.hecho);
  const [i, setI] = useState(datos.completados > 0 && primeroPendiente >= 0 ? primeroPendiente + 1 : 0);
  const ultimo = datos.pasos.length + 1;
  const agencia = datos.vertical === 'agencia';

  function cerrar() {
    accion.mutate('visto');
    onCerrar();
  }
  function ir(paso: Paso) {
    accion.mutate('visto');
    onCerrar();
    navigate(paso.enlace);
  }

  const paso = i >= 1 && i <= datos.pasos.length ? datos.pasos[i - 1]! : null;

  return (
    <div className="modal-fondo" onClick={cerrar}>
      <div className="modal pp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-labelledby="pp-titulo">
        <div className="modal-cab">
          <span className="pp-eyebrow">
            Primeros pasos{paso ? ` · ${i} de ${datos.pasos.length}` : ''}
          </span>
          <button type="button" className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        </div>

        <div className="pp-puntos" aria-hidden="true">
          {datos.pasos.map((p, n) => (
            <button
              key={p.id}
              type="button"
              tabIndex={-1}
              className={`pp-punto${n + 1 === i ? ' activo' : ''}${p.hecho ? ' hecho' : ''}`}
              onClick={() => setI(n + 1)}
            />
          ))}
        </div>

        {i === 0 && (
          <div className="pp-cuerpo">
            <h2 id="pp-titulo">Bienvenido a tu CRM</h2>
            <p>
              Te guiamos para dejarlo listo en {datos.pasos.length} pasos.{' '}
              {agencia
                ? 'Primero tus servicios y paquetes (con ellos armas propuestas), luego tu equipo y tus canales, y al final tu primer lead.'
                : 'Primero tu proyecto, sus tipologías y unidades (con ellos armas proformas), luego tu equipo y tus canales, y al final tu primer lead.'}
            </p>
            <p className="meta">
              {datos.completados > 0
                ? `Ya tienes ${datos.completados} de ${datos.total} listos.`
                : 'Cada paso se marca solo cuando lo haces.'}{' '}
              Puedes cerrar la guía cuando quieras y volver desde tu menú (abajo a la izquierda) o desde Resumen.
            </p>
          </div>
        )}

        {paso && (
          <div className="pp-cuerpo">
            <div className="pp-titulo-paso">
              <span className={`pp-num${paso.hecho ? ' hecho' : ''}`}>
                {paso.hecho ? <Icono nombre="check" tam={16} /> : i}
              </span>
              <h2 id="pp-titulo">{paso.titulo}</h2>
            </div>
            <p>{paso.texto}</p>
            <div className="pp-estado">
              <Estado paso={paso} />
              {paso.hecho && <span className="meta">Ya está. Puedes revisarlo o seguir.</span>}
            </div>
            <button type="button" className={paso.hecho ? 'btn btn-sec' : 'btn'} onClick={() => ir(paso)}>
              {paso.accion}
            </button>
          </div>
        )}

        {i === ultimo && (
          <div className="pp-cuerpo">
            <h2 id="pp-titulo">
              {datos.completados === datos.total ? 'Todo listo' : `Llevas ${datos.completados} de ${datos.total}`}
            </h2>
            <ul className="pp-lista">
              {datos.pasos.map((p, n) => (
                <li key={p.id}>
                  <button type="button" className="pp-enlace" onClick={() => setI(n + 1)}>
                    <span className={`pp-num chico${p.hecho ? ' hecho' : ''}`}>{p.hecho ? <Icono nombre="check" tam={12} /> : n + 1}</span>
                    {p.titulo}
                  </button>
                  <Estado paso={p} />
                </li>
              ))}
            </ul>
            <p className="meta">La tarjeta «Primeros pasos» de Resumen te muestra lo que falta hasta terminar.</p>
          </div>
        )}

        <div className="pp-pie">
          <button type="button" className="btn btn-sec" disabled={i === 0} onClick={() => setI(i - 1)}>
            Anterior
          </button>
          {i < ultimo ? (
            <button type="button" className="btn" onClick={() => setI(i + 1)}>
              {i === 0 ? 'Empezar' : 'Siguiente'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={cerrar}>
              Cerrar guía
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Tarjeta de Resumen: avance y pasos pendientes, hasta terminar u ocultarla. */
export function TarjetaPrimerosPasos() {
  const datos = usePrimerosPasos();
  const accion = useAccion();
  const abrir = useAbrirGuia();
  const navigate = useNavigate();
  const d = datos.data;
  if (!d || d.total === 0) return null;
  // Sin la tarjeta (oculta o todo hecho) queda un banner discreto para reabrir la guía.
  if (d.oculto || d.completados === d.total) {
    return (
      <div className="pp-banner">
        <Icono nombre="info" tam={18} />
        <span className="pp-banner-texto">
          <strong>¿Necesitas repasar cómo usar el CRM?</strong>{' '}
          <span className="meta">
            {d.completados === d.total
              ? 'Ya completaste los primeros pasos; la guía sigue disponible.'
              : `Llevas ${d.completados} de ${d.total} primeros pasos.`}
          </span>
        </span>
        {d.completados < d.total && (
          <button type="button" className="btn btn-sec" onClick={() => accion.mutate('mostrar')}>
            Mostrar mi avance
          </button>
        )}
        <button type="button" className="btn btn-sec" onClick={abrir}>
          Abrir guía de primeros pasos
        </button>
      </div>
    );
  }
  const pct = Math.round((d.completados / d.total) * 100);

  return (
    <section className="panel pp-tarjeta">
      <div className="panel-cab">
        <h2 className="titulo-panel">
          <Icono nombre="check" tam={16} />Primeros pasos <span className="chip chip-gris">{d.completados} de {d.total}</span>
        </h2>
        <div className="pp-acciones">
          <button type="button" className="btn btn-sec" onClick={abrir}>Abrir guía</button>
          <button type="button" className="btn btn-sec" onClick={() => accion.mutate('ocultar')}>Ocultar</button>
        </div>
      </div>
      <div className="pp-barra" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${pct}%` }} />
      </div>
      <ul className="pp-lista pp-lista-tarjeta">
        {d.pasos.map((p, n) => (
          <li key={p.id} className={p.hecho ? 'hecho' : ''}>
            <button type="button" className="pp-enlace" onClick={() => navigate(p.enlace)} disabled={p.hecho}>
              <span className={`pp-num chico${p.hecho ? ' hecho' : ''}`}>{p.hecho ? <Icono nombre="check" tam={12} /> : n + 1}</span>
              {p.titulo}
            </button>
            {!p.hecho && <span className="pp-ir">{p.accion} →</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Envuelve la app: abre el asistente solo la primera vez y deja `useAbrirGuia()` para
 * reabrirlo desde el menú o desde Resumen.
 */
export function ProveedorGuia({ children }: { children: ReactNode }) {
  const datos = usePrimerosPasos();
  const [abierta, setAbierta] = useState(false);
  const [autoMostrada, setAutoMostrada] = useState(false);
  const accion = useAccion();
  const d = datos.data;
  if (d?.abrirAsistente && !autoMostrada && !abierta) {
    setAutoMostrada(true);
    setAbierta(true);
  }
  const abrir = () => {
    if (d?.oculto) accion.mutate('mostrar');
    setAbierta(true);
  };
  return (
    <AbrirGuiaContext.Provider value={abrir}>
      {children}
      {abierta && d && d.total > 0 && <AsistentePrimerosPasos datos={d} onCerrar={() => setAbierta(false)} />}
    </AbrirGuiaContext.Provider>
  );
}
