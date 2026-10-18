import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import Kpi from '../components/Kpi.js';

/**
 * Clientes activos y cobranza de la agencia (docs/22-VERTICAL-AGENCIA.md). Solo la cuenta de
 * Lucuma llega aquí; el servidor lo impide para cualquier otro.
 *
 * Tres pestañas: los clientes con sus servicios contratados, la cobranza del mes (lo que hay
 * que cobrar, lo cobrado y lo vencido) y los ingresos de los últimos 12 meses.
 */

interface Servicio {
  id: string;
  projectId: string | null;
  project: { id: string; name: string } | null;
  name: string;
  amount: string;
  currency: string;
  igvIncluido: boolean;
  periodicidad: 'mensual' | 'anual' | 'unico' | 'variable' | 'comision';
  comisionPct: string | null;
  diaPago: number | null;
  inicio: string;
  fin: string | null;
  estado: 'activo' | 'pausado' | 'terminado';
  notes: string | null;
}

interface Cliente {
  id: string;
  name: string;
  legalName: string | null;
  ruc: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  active: boolean;
  leadId: string | null;
  servicios: Servicio[];
  mensual: number;
  vencido: { n: number; total: number };
}

interface Cobro {
  id: string;
  clienteId: string;
  cliente: { id: string; name: string };
  servicio: { id: string; periodicidad: string } | null;
  periodo: string;
  concepto: string;
  base: string;
  total: string;
  currency: string;
  vence: string;
  estado: 'pendiente' | 'pagado' | 'anulado';
  pagadoEl: string | null;
  medio: string | null;
  comprobante: string | null;
}

interface Cobranza {
  mes: string;
  hoy: string;
  cobros: Cobro[];
  anteriores: Cobro[];
  totales: { esperado: number; cobrado: number; pendiente: number; vencido: number };
}

interface Ingresos {
  meses: { mes: string; facturado: number; cobrado: number }[];
  porServicio: { servicio: string; total: number }[];
  mensualActual: number;
  enDolares: number;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dinero = (n: number | string, mon = 'PEN') =>
  `${mon === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const corto = (n: number) => `S/ ${Math.round(n).toLocaleString('es-PE')}`;
const dia = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
const nombreMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const hoyIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const mover = (m: string, n: number) => {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const PERIODICIDAD: Record<Servicio['periodicidad'], string> = { mensual: 'mensual', anual: 'anual', unico: 'pago único', variable: 'variable', comision: 'comisión por venta' };

/** Atajos para los acuerdos que no son paquetes del catálogo. */
const ATAJOS: { nombre: string; periodicidad: Servicio['periodicidad'] }[] = [
  { nombre: 'Servidor web', periodicidad: 'anual' },
  { nombre: 'Alianza comercial', periodicidad: 'comision' },
];

export default function Clientes() {
  const [params, setParams] = useSearchParams();
  const vista = params.get('vista') ?? 'clientes';
  const pestanas: [string, string][] = [
    ['clientes', 'Clientes'],
    ['cobranza', 'Cobranza'],
    ['ingresos', 'Ingresos'],
  ];
  return (
    <>
      <nav className="pestanas" aria-label="Secciones de clientes">
        {pestanas.map(([id, texto]) => (
          <button key={id} type="button" className={vista === id ? 'activa' : ''} onClick={() => setParams({ vista: id }, { replace: true })}>
            {texto}
          </button>
        ))}
      </nav>
      {vista === 'clientes' && <ListaClientes />}
      {vista === 'cobranza' && <VistaCobranza />}
      {vista === 'ingresos' && <VistaIngresos />}
    </>
  );
}

// ------------------------------------------------------------------ clientes

function ListaClientes() {
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: () => api.get<Cliente[]>('/clientes') });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [verArchivados, setVerArchivados] = useState(false);
  const crear = useMutation({
    mutationFn: (name: string) => api.post<Cliente>('/clientes', { name }),
    onSuccess: (c) => {
      setNuevo('');
      setAbierto(c.id);
      qc.invalidateQueries({ queryKey: ['clientes'] });
    },
  });

  const lista = (clientes.data ?? []).filter((c) => verArchivados || c.active);
  const activos = (clientes.data ?? []).filter((c) => c.active);
  const mensual = activos.reduce((t, c) => t + c.mensual, 0);
  const vencido = activos.reduce((t, c) => t + c.vencido.total, 0);

  return (
    <>
      <div className="kpis">
        <Kpi titulo="Clientes activos" icono="cuenta" tono="solido" valor={clientes.data ? String(activos.length) : '—'} />
        <Kpi titulo="Ingreso mensual" icono="reportes" valor={clientes.data ? corto(mensual) : '—'} nota="mensuales + anuales ÷ 12, sin IGV" />
        <Kpi titulo="Vencido" icono="alerta" valor={clientes.data ? corto(vencido) : '—'} nota="con IGV" />
        <Kpi titulo="Servicios activos" icono="proyectos" valor={clientes.data ? String(activos.flatMap((c) => c.servicios).filter((s) => s.estado === 'activo').length) : '—'} />
      </div>

      <div className="card">
        <form
          className="fila-form"
          style={{ marginTop: 0 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (nuevo.trim()) crear.mutate(nuevo.trim());
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <label htmlFor="cli-nuevo">Nuevo cliente</label>
            <input id="cli-nuevo" placeholder="Nombre comercial" value={nuevo} onChange={(e) => setNuevo(e.target.value)} />
          </div>
          <button className="btn" disabled={!nuevo.trim() || crear.isPending}>Agregar</button>
          <label className="meta" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={verArchivados} onChange={(e) => setVerArchivados(e.target.checked)} /> Ver archivados
          </label>
        </form>
        {crear.error && <p className="error">{(crear.error as Error).message}</p>}
      </div>

      {clientes.isLoading && <div className="vacio">Cargando…</div>}
      {clientes.data && lista.length === 0 && (
        <div className="vacio">Todavía no hay clientes. Agrega uno arriba, o conviértelo desde la ficha de un lead ganado.</div>
      )}

      {lista.map((c) => (
        <div className="card" key={c.id} style={c.active ? undefined : { opacity: 0.6 }}>
          <button type="button" className="fila" style={{ width: '100%', background: 'none', border: 0, padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
            <span>
              <span className="nombre">{c.name}</span>
              {!c.active && <span className="chip chip-gris" style={{ marginLeft: 6 }}>archivado</span>}
              {c.vencido.n > 0 && <span className="chip chip-rojo" style={{ marginLeft: 6 }}>{c.vencido.n} vencido(s) · {dinero(c.vencido.total)}</span>}
              <br />
              <span className="meta">
                {c.servicios.filter((s) => s.estado === 'activo').map((s) => s.name).join(' · ') || 'Sin servicios activos'}
              </span>
            </span>
            <span className="nombre" style={{ whiteSpace: 'nowrap' }}>{c.mensual > 0 ? `${corto(c.mensual)} / mes` : ''}</span>
          </button>
          {abierto === c.id && <DetalleCliente cliente={c} />}
        </div>
      ))}
    </>
  );
}

function DetalleCliente({ cliente }: { cliente: Cliente }) {
  const qc = useQueryClient();
  const [datos, setDatos] = useState({
    name: cliente.name,
    legalName: cliente.legalName ?? '',
    ruc: cliente.ruc ?? '',
    contactName: cliente.contactName ?? '',
    email: cliente.email ?? '',
    phone: cliente.phone ?? '',
    notes: cliente.notes ?? '',
  });
  const guardar = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.patch(`/clientes/${cliente.id}`, d),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clientes'] }),
  });
  const campo = (k: keyof typeof datos, etiqueta: string, ph = '') => (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label htmlFor={`${cliente.id}-${k}`}>{etiqueta}</label>
      <input id={`${cliente.id}-${k}`} value={datos[k]} placeholder={ph} onChange={(e) => setDatos({ ...datos, [k]: e.target.value })} />
    </div>
  );

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--borde)', paddingTop: 12 }}>
      <strong>Servicios contratados</strong>
      {cliente.servicios.length === 0 && <p className="meta">Sin servicios todavía.</p>}
      {cliente.servicios.map((s) => (
        <FilaServicio key={s.id} servicio={s} />
      ))}
      <NuevoServicio clienteId={cliente.id} />

      <div style={{ marginTop: 16 }}>
        <strong>Datos del cliente</strong>
        <div className="fila-form">
          {campo('name', 'Nombre comercial')}
          {campo('legalName', 'Razón social')}
          {campo('ruc', 'RUC', '11 dígitos')}
        </div>
        <div className="fila-form">
          {campo('contactName', 'Contacto')}
          {campo('email', 'Correo')}
          {campo('phone', 'Teléfono')}
        </div>
        <div className="fila-form">{campo('notes', 'Notas')}</div>
        <div className="acciones" style={{ marginTop: 10 }}>
          <button
            className="btn btn-sec"
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, k === 'name' ? v : v.trim() || null])))}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar datos'}
          </button>
          <button className="btn btn-sec" disabled={guardar.isPending} onClick={() => guardar.mutate({ active: !cliente.active })}>
            {cliente.active ? 'Archivar cliente' : 'Reactivar cliente'}
          </button>
          {cliente.leadId && <a className="meta" href={`/leads/${cliente.leadId}`}>Ver el lead de origen</a>}
        </div>
        {guardar.error && <p className="error">{(guardar.error as Error).message}</p>}
      </div>
    </div>
  );
}

interface FormServicio {
  projectId: string;
  name: string;
  amount: string;
  currency: string;
  igvIncluido: boolean;
  periodicidad: Servicio['periodicidad'];
  comisionPct: string;
  diaPago: string;
  inicio: string;
  fin: string;
  estado: Servicio['estado'];
}

function aCuerpo(f: FormServicio) {
  return {
    projectId: f.projectId || null,
    name: f.name.trim(),
    amount: Number(f.amount.replace(',', '.')) || 0,
    currency: f.currency,
    igvIncluido: f.igvIncluido,
    periodicidad: f.periodicidad,
    comisionPct: f.periodicidad === 'comision' ? Number(f.comisionPct.replace(',', '.')) || null : null,
    diaPago: f.diaPago ? Number(f.diaPago) : null,
    inicio: f.inicio,
    fin: f.fin || null,
    estado: f.estado,
  };
}

function CamposServicio({ f, set, id }: { f: FormServicio; set: (f: FormServicio) => void; id: string }) {
  const catalogo = useQuery({ queryKey: ['projects'], queryFn: () => api.get<{ id: string; name: string }[]>('/projects') });
  const comision = f.periodicidad === 'comision';
  const cambios = (a: (typeof ATAJOS)[number]): Partial<FormServicio> => ({
    periodicidad: a.periodicidad,
    ...(a.periodicidad === 'comision' ? { amount: '0', diaPago: '' } : {}),
  });
  return (
    <>
      <div className="acciones" style={{ marginTop: 6 }}>
        <span className="meta">Atajos:</span>
        {ATAJOS.map((a) => (
          <button
            key={a.nombre}
            type="button"
            className="btn btn-sec"
            onClick={() => set({ ...f, ...cambios(a), name: a.nombre, projectId: catalogo.data?.find((p) => p.name === a.nombre)?.id ?? f.projectId })}
          >
            {a.nombre}
          </button>
        ))}
      </div>
      <div className="fila-form">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={`${id}-cat`}>Servicio del catálogo</label>
          <select
            id={`${id}-cat`}
            value={f.projectId}
            onChange={(e) => {
              const p = catalogo.data?.find((x) => x.id === e.target.value);
              const atajo = ATAJOS.find((a) => a.nombre === p?.name);
              set({ ...f, ...(atajo ? cambios(atajo) : {}), projectId: e.target.value, name: f.name || p?.name || '' });
            }}
          >
            <option value="">A medida / otro</option>
            {catalogo.data?.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={`${id}-nom`}>Nombre que se muestra</label>
          <input id={`${id}-nom`} value={f.name} placeholder="SEO · Crecimiento" onChange={(e) => set({ ...f, name: e.target.value })} />
        </div>
      </div>
      <div className="fila-form">
        {comision ? (
          <div style={{ width: 120 }}>
            <label htmlFor={`${id}-pct`}>% por venta</label>
            <input id={`${id}-pct`} inputMode="decimal" placeholder="3" value={f.comisionPct} onChange={(e) => set({ ...f, comisionPct: e.target.value })} />
          </div>
        ) : (
          <div style={{ width: 120 }}>
            <label htmlFor={`${id}-monto`}>{f.periodicidad === 'anual' ? 'Monto al año' : 'Monto'}</label>
            <input id={`${id}-monto`} inputMode="decimal" value={f.amount} onChange={(e) => set({ ...f, amount: e.target.value })} />
          </div>
        )}
        <div>
          <label htmlFor={`${id}-mon`}>Moneda</label>
          <select id={`${id}-mon`} value={f.currency} onChange={(e) => set({ ...f, currency: e.target.value })}>
            <option value="PEN">S/</option>
            <option value="USD">US$</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-igv`}>IGV</label>
          <select id={`${id}-igv`} value={f.igvIncluido ? 'si' : 'no'} onChange={(e) => set({ ...f, igvIncluido: e.target.value === 'si' })}>
            <option value="no">+ IGV</option>
            <option value="si">IGV incluido</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-per`}>Cobro</label>
          <select id={`${id}-per`} value={f.periodicidad} onChange={(e) => set({ ...f, periodicidad: e.target.value as Servicio['periodicidad'] })}>
            <option value="mensual">Mensual</option>
            <option value="anual">Anual</option>
            <option value="unico">Pago único</option>
            <option value="variable">Variable (a mano)</option>
            <option value="comision">Comisión por venta</option>
          </select>
        </div>
        {(f.periodicidad === 'mensual' || f.periodicidad === 'anual') && (
          <div style={{ width: 90 }}>
            <label htmlFor={`${id}-dia`}>Día de pago</label>
            <input id={`${id}-dia`} inputMode="numeric" placeholder="1-31" value={f.diaPago} onChange={(e) => set({ ...f, diaPago: e.target.value.replace(/\D/g, '').slice(0, 2) })} />
          </div>
        )}
      </div>
      <div className="fila-form">
        <div>
          <label htmlFor={`${id}-ini`}>Inicio</label>
          <input id={`${id}-ini`} type="date" value={f.inicio} onChange={(e) => set({ ...f, inicio: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-fin`}>Fin o renovación</label>
          <input id={`${id}-fin`} type="date" value={f.fin} onChange={(e) => set({ ...f, fin: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${id}-est`}>Estado</label>
          <select id={`${id}-est`} value={f.estado} onChange={(e) => set({ ...f, estado: e.target.value as Servicio['estado'] })}>
            <option value="activo">Activo</option>
            <option value="pausado">Pausado</option>
            <option value="terminado">Terminado</option>
          </select>
        </div>
      </div>
    </>
  );
}

function FilaServicio({ servicio: s }: { servicio: Servicio }) {
  const qc = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [venta, setVenta] = useState(false);
  const [f, setF] = useState<FormServicio>({
    projectId: s.projectId ?? '',
    name: s.name,
    amount: String(Number(s.amount)),
    currency: s.currency,
    igvIncluido: s.igvIncluido,
    periodicidad: s.periodicidad,
    comisionPct: s.comisionPct ? String(Number(s.comisionPct)) : '',
    diaPago: s.diaPago ? String(s.diaPago) : '',
    inicio: s.inicio.slice(0, 10),
    fin: s.fin?.slice(0, 10) ?? '',
    estado: s.estado,
  });
  const guardar = useMutation({
    mutationFn: () => api.patch(`/clientes/servicios/${s.id}`, aCuerpo(f)),
    onSuccess: () => {
      setEditando(false);
      qc.invalidateQueries({ queryKey: ['clientes'] });
      qc.invalidateQueries({ queryKey: ['cobranza'] });
    },
  });
  const chip = s.estado === 'activo' ? 'chip-verde' : 'chip-gris';
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid var(--borde)' }}>
      <div className="fila">
        <span>
          {s.name} <span className={`chip ${chip}`}>{s.estado}</span>
          <br />
          <span className="meta">
            {s.periodicidad === 'comision'
              ? `${Number(s.comisionPct ?? 0)} % de cada venta + IGV`
              : `${dinero(s.amount, s.currency)} ${s.igvIncluido ? 'IGV incl.' : '+ IGV'} · ${PERIODICIDAD[s.periodicidad]}`}
            {s.periodicidad === 'mensual' && ` · paga el día ${s.diaPago ?? Number(s.inicio.slice(8, 10))}`}
            {s.periodicidad === 'anual' && ` · cada ${new Date(s.inicio.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('es-PE', { month: 'long', timeZone: 'UTC' })}`} · desde {dia(s.inicio)}
            {s.fin && ` · renueva ${dia(s.fin)}`}
          </span>
        </span>
        <span className="acciones">
          {s.periodicidad === 'comision' && s.estado === 'activo' && (
            <button type="button" className="btn" onClick={() => setVenta(!venta)}>{venta ? 'Cerrar' : 'Registrar venta'}</button>
          )}
          <button type="button" className="btn btn-sec" onClick={() => setEditando(!editando)}>{editando ? 'Cerrar' : 'Editar'}</button>
        </span>
      </div>
      {venta && <RegistrarVenta servicio={s} alTerminar={() => setVenta(false)} />}
      {editando && (
        <>
          <CamposServicio f={f} set={setF} id={s.id} />
          <p className="meta" style={{ marginTop: 6 }}>
            Un cambio de monto aplica a los cobros pendientes desde este mes; los pasados quedan como se cobraron. Pausar o terminar anula los cobros de meses futuros.
          </p>
          <div className="acciones" style={{ marginTop: 8 }}>
            <button className="btn" disabled={guardar.isPending || !f.name.trim()} onClick={() => guardar.mutate()}>
              {guardar.isPending ? 'Guardando…' : 'Guardar servicio'}
            </button>
          </div>
          {guardar.error && <p className="error">{(guardar.error as Error).message}</p>}
        </>
      )}
    </div>
  );
}

function RegistrarVenta({ servicio: s, alTerminar }: { servicio: Servicio; alTerminar: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ detalle: '', monto: '', fecha: hoyIso() });
  const monto = Number(v.monto.replace(',', '.')) || 0;
  const comision = (monto * Number(s.comisionPct ?? 0)) / 100;
  const registrar = useMutation({
    mutationFn: () => api.post(`/clientes/servicios/${s.id}/ventas`, { detalle: v.detalle.trim(), monto, fecha: v.fecha }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cobranza'] });
      qc.invalidateQueries({ queryKey: ['clientes'] });
      alTerminar();
    },
  });
  return (
    <div style={{ marginTop: 8 }}>
      <div className="fila-form">
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor={`${s.id}-vd`}>Venta</label>
          <input id={`${s.id}-vd`} placeholder="Dpto 504 · Juan Pérez" value={v.detalle} onChange={(e) => setV({ ...v, detalle: e.target.value })} />
        </div>
        <div style={{ width: 130 }}>
          <label htmlFor={`${s.id}-vm`}>Monto vendido</label>
          <input id={`${s.id}-vm`} inputMode="decimal" value={v.monto} onChange={(e) => setV({ ...v, monto: e.target.value })} />
        </div>
        <div>
          <label htmlFor={`${s.id}-vf`}>Fecha</label>
          <input id={`${s.id}-vf`} type="date" value={v.fecha} onChange={(e) => setV({ ...v, fecha: e.target.value })} />
        </div>
      </div>
      <p className="meta" style={{ marginTop: 6 }}>
        Comisión: {dinero(comision, s.currency)} + IGV = {dinero(comision * 1.18, s.currency)}. Queda como cobro pendiente en Cobranza.
      </p>
      <div className="acciones" style={{ marginTop: 8 }}>
        <button className="btn" disabled={registrar.isPending || !v.detalle.trim() || monto <= 0} onClick={() => registrar.mutate()}>
          {registrar.isPending ? 'Guardando…' : 'Registrar venta'}
        </button>
      </div>
      {registrar.error && <p className="error">{(registrar.error as Error).message}</p>}
    </div>
  );
}

function NuevoServicio({ clienteId }: { clienteId: string }) {
  const qc = useQueryClient();
  const vacio: FormServicio = { projectId: '', name: '', amount: '', currency: 'PEN', igvIncluido: false, periodicidad: 'mensual', comisionPct: '', diaPago: '', inicio: hoyIso(), fin: '', estado: 'activo' };
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<FormServicio>(vacio);
  const crear = useMutation({
    mutationFn: () => api.post(`/clientes/${clienteId}/servicios`, aCuerpo(f)),
    onSuccess: () => {
      setF(vacio);
      setAbierto(false);
      qc.invalidateQueries({ queryKey: ['clientes'] });
      qc.invalidateQueries({ queryKey: ['cobranza'] });
    },
  });
  if (!abierto) {
    return (
      <button type="button" className="btn btn-sec" style={{ marginTop: 10 }} onClick={() => setAbierto(true)}>
        Agregar servicio
      </button>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      <CamposServicio f={f} set={setF} id={`nuevo-${clienteId}`} />
      <p className="meta" style={{ marginTop: 6 }}>
        Los cobros mensuales empiezan este mes aunque el inicio sea anterior: lo ya cobrado antes no aparece como deuda. El anual se cobra en el mes aniversario del inicio. La alianza comercial no genera cobros sola: cada venta que registres crea el cobro de la comisión.
      </p>
      <div className="acciones" style={{ marginTop: 8 }}>
        <button className="btn" disabled={crear.isPending || !f.name.trim() || (f.periodicidad === 'comision' ? !f.comisionPct : !f.amount)} onClick={() => crear.mutate()}>
          {crear.isPending ? 'Guardando…' : 'Guardar servicio'}
        </button>
        <button className="btn btn-sec" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {crear.error && <p className="error">{(crear.error as Error).message}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ cobranza

function VistaCobranza() {
  const [mes, setMes] = useState(() => hoyIso().slice(0, 7));
  const datos = useQuery({ queryKey: ['cobranza', mes], queryFn: () => api.get<Cobranza>(`/clientes/cobranza?mes=${mes}`) });
  const d = datos.data;
  return (
    <>
      <div className="card fila">
        <button type="button" className="btn btn-sec" onClick={() => setMes(mover(mes, -1))} aria-label="Mes anterior">‹</button>
        <strong style={{ textTransform: 'capitalize' }}>{nombreMes(mes)}</strong>
        <button type="button" className="btn btn-sec" onClick={() => setMes(mover(mes, 1))} aria-label="Mes siguiente">›</button>
      </div>
      <div className="kpis">
        <Kpi titulo="Por cobrar en el mes" icono="calendario" tono="solido" valor={d ? corto(d.totales.esperado) : '—'} nota="con IGV" />
        <Kpi titulo="Cobrado" icono="check" valor={d ? corto(d.totales.cobrado) : '—'} />
        <Kpi titulo="Pendiente" icono="reloj" valor={d ? corto(d.totales.pendiente) : '—'} nota="aún no vence" />
        <Kpi titulo="Vencido" icono="alerta" valor={d ? corto(d.totales.vencido) : '—'} nota="incluye meses anteriores" />
      </div>

      {d && d.anteriores.length > 0 && (
        <div className="card">
          <strong>Pendientes de meses anteriores</strong>
          <TablaCobros cobros={d.anteriores} hoy={d.hoy} />
        </div>
      )}

      <div className="card">
        <strong>Cobros de {nombreMes(mes)}</strong>
        {datos.isLoading && <p className="meta">Cargando…</p>}
        {d && d.cobros.length === 0 && <p className="meta">No hay cobros este mes.</p>}
        {d && d.cobros.length > 0 && <TablaCobros cobros={d.cobros} hoy={d.hoy} />}
      </div>

      <NuevoCobro mes={mes} />
    </>
  );
}

function TablaCobros({ cobros, hoy }: { cobros: Cobro[]; hoy: string }) {
  const [pagando, setPagando] = useState<string | null>(null);
  return (
    <table className="tabla tabla-movil" style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th>Cliente</th>
          <th>Concepto</th>
          <th>Vence</th>
          <th>Total</th>
          <th>Estado</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {cobros.map((c) => (
          <FilaCobro key={c.id} cobro={c} hoy={hoy} pagando={pagando === c.id} setPagando={(v) => setPagando(v ? c.id : null)} />
        ))}
      </tbody>
    </table>
  );
}

function FilaCobro({ cobro: c, hoy, pagando, setPagando }: { cobro: Cobro; hoy: string; pagando: boolean; setPagando: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [pago, setPago] = useState({ pagadoEl: hoyIso(), medio: '', comprobante: '' });
  const [monto, setMonto] = useState('');
  const cambiar = useMutation({
    mutationFn: (d: Record<string, unknown>) => api.patch(`/clientes/cobros/${c.id}`, d),
    onSuccess: () => {
      setPagando(false);
      qc.invalidateQueries({ queryKey: ['cobranza'] });
      qc.invalidateQueries({ queryKey: ['clientes'] });
      qc.invalidateQueries({ queryKey: ['ingresos'] });
    },
  });
  const vencido = c.estado === 'pendiente' && c.vence.slice(0, 10) < hoy;
  const estado =
    c.estado === 'pagado' ? <span className="chip chip-verde">pagado {c.pagadoEl ? dia(c.pagadoEl) : ''}</span>
    : c.estado === 'anulado' ? <span className="chip chip-gris">anulado</span>
    : vencido ? <span className="chip chip-rojo">vencido</span>
    : <span className="chip chip-alerta">pendiente</span>;
  const variable = c.servicio?.periodicidad === 'variable' || !c.servicio;
  return (
    <>
      <tr style={c.estado === 'anulado' ? { opacity: 0.55 } : undefined}>
        <td className="t-titulo">{c.cliente.name}</td>
        <td data-label="Concepto">
          {c.concepto}
          {c.comprobante && <><br /><span className="meta">Comp. {c.comprobante}{c.medio ? ` · ${c.medio}` : ''}</span></>}
        </td>
        <td data-label="Vence">{dia(c.vence)}</td>
        <td data-label="Total">
          {dinero(c.total, c.currency)}
          <br />
          <span className="meta">base {dinero(c.base, c.currency)}</span>
        </td>
        <td data-label="Estado">{estado}</td>
        <td className="accion">
          {c.estado === 'pendiente' && (
            <button type="button" className="btn btn-sec" onClick={() => setPagando(!pagando)}>
              {pagando ? 'Cerrar' : 'Registrar pago'}
            </button>
          )}{' '}
          {c.estado === 'pendiente' && (
            <button type="button" className="btn btn-sec" disabled={cambiar.isPending} onClick={() => confirm('¿Anular este cobro?') && cambiar.mutate({ estado: 'anulado' })}>
              Anular
            </button>
          )}
          {c.estado !== 'pendiente' && (
            <button type="button" className="btn btn-sec" disabled={cambiar.isPending} onClick={() => cambiar.mutate({ estado: 'pendiente' })}>
              Volver a pendiente
            </button>
          )}
        </td>
      </tr>
      {pagando && (
        <tr>
          <td colSpan={6}>
            <div className="fila-form" style={{ marginTop: 0 }}>
              <div>
                <label htmlFor={`${c.id}-f`}>Fecha de pago</label>
                <input id={`${c.id}-f`} type="date" value={pago.pagadoEl} onChange={(e) => setPago({ ...pago, pagadoEl: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${c.id}-m`}>Medio</label>
                <input id={`${c.id}-m`} placeholder="Transferencia, Yape…" value={pago.medio} onChange={(e) => setPago({ ...pago, medio: e.target.value })} />
              </div>
              <div>
                <label htmlFor={`${c.id}-c`}>N.° de factura o boleta</label>
                <input id={`${c.id}-c`} placeholder="F001-123" value={pago.comprobante} onChange={(e) => setPago({ ...pago, comprobante: e.target.value })} />
              </div>
              {variable && (
                <div style={{ width: 130 }}>
                  <label htmlFor={`${c.id}-a`}>Monto final (+ IGV)</label>
                  <input id={`${c.id}-a`} inputMode="decimal" placeholder={String(Number(c.base))} value={monto} onChange={(e) => setMonto(e.target.value)} />
                </div>
              )}
              <button
                className="btn"
                disabled={cambiar.isPending}
                onClick={() =>
                  cambiar.mutate({
                    estado: 'pagado',
                    pagadoEl: pago.pagadoEl,
                    medio: pago.medio.trim() || null,
                    comprobante: pago.comprobante.trim() || null,
                    ...(variable && monto ? { amount: Number(monto.replace(',', '.')), igvIncluido: false } : {}),
                  })
                }
              >
                Guardar pago
              </button>
            </div>
            {cambiar.error && <p className="error">{(cambiar.error as Error).message}</p>}
          </td>
        </tr>
      )}
    </>
  );
}

function NuevoCobro({ mes }: { mes: string }) {
  const qc = useQueryClient();
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: () => api.get<Cliente[]>('/clientes') });
  const vacio = { clienteId: '', servicioId: '', concepto: '', amount: '', igvIncluido: false, vence: `${mes}-${hoyIso().slice(8, 10)}` };
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState(vacio);
  const cliente = clientes.data?.find((c) => c.id === f.clienteId);
  const crear = useMutation({
    mutationFn: () =>
      api.post('/clientes/cobros', {
        clienteId: f.clienteId,
        servicioId: f.servicioId || null,
        periodo: mes,
        concepto: f.concepto.trim(),
        amount: Number(f.amount.replace(',', '.')) || 0,
        igvIncluido: f.igvIncluido,
        vence: f.vence,
      }),
    onSuccess: () => {
      setF(vacio);
      setAbierto(false);
      qc.invalidateQueries({ queryKey: ['cobranza'] });
    },
  });
  if (!abierto) {
    return (
      <div className="card">
        <button type="button" className="btn btn-sec" onClick={() => setAbierto(true)}>Agregar cobro a mano</button>
        <span className="meta" style={{ marginLeft: 8 }}>Para servicios variables o cobros extra.</span>
      </div>
    );
  }
  return (
    <div className="card">
      <strong>Cobro a mano · {nombreMes(mes)}</strong>
      <div className="fila-form">
        <div style={{ minWidth: 180 }}>
          <label htmlFor="nc-cli">Cliente</label>
          <select id="nc-cli" value={f.clienteId} onChange={(e) => setF({ ...f, clienteId: e.target.value, servicioId: '' })}>
            <option value="">Elegir…</option>
            {clientes.data?.filter((c) => c.active).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        {cliente && cliente.servicios.some((s) => s.periodicidad === 'unico' || s.periodicidad === 'variable') && (
          <div style={{ minWidth: 180 }}>
            <label htmlFor="nc-ser">Servicio</label>
            <select
              id="nc-ser"
              value={f.servicioId}
              onChange={(e) => {
                const s = cliente.servicios.find((x) => x.id === e.target.value);
                setF({ ...f, servicioId: e.target.value, concepto: f.concepto || s?.name || '', amount: f.amount || (s ? String(Number(s.amount)) : ''), igvIncluido: s?.igvIncluido ?? f.igvIncluido });
              }}
            >
              <option value="">Ninguno (extra)</option>
              {cliente.servicios.filter((s) => s.periodicidad === 'unico' || s.periodicidad === 'variable').map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1, minWidth: 180 }}>
          <label htmlFor="nc-con">Concepto</label>
          <input id="nc-con" placeholder="Pacientes de octubre (4)" value={f.concepto} onChange={(e) => setF({ ...f, concepto: e.target.value })} />
        </div>
      </div>
      <div className="fila-form">
        <div style={{ width: 120 }}>
          <label htmlFor="nc-monto">Monto</label>
          <input id="nc-monto" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </div>
        <div>
          <label htmlFor="nc-igv">IGV</label>
          <select id="nc-igv" value={f.igvIncluido ? 'si' : 'no'} onChange={(e) => setF({ ...f, igvIncluido: e.target.value === 'si' })}>
            <option value="no">+ IGV</option>
            <option value="si">IGV incluido</option>
          </select>
        </div>
        <div>
          <label htmlFor="nc-vence">Vence</label>
          <input id="nc-vence" type="date" value={f.vence} onChange={(e) => setF({ ...f, vence: e.target.value })} />
        </div>
        <button className="btn" disabled={crear.isPending || !f.clienteId || !f.concepto.trim() || !f.amount} onClick={() => crear.mutate()}>
          Guardar cobro
        </button>
        <button className="btn btn-sec" onClick={() => setAbierto(false)}>Cancelar</button>
      </div>
      {crear.error && <p className="error">{(crear.error as Error).message}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ ingresos

function VistaIngresos() {
  const datos = useQuery({ queryKey: ['ingresos'], queryFn: () => api.get<Ingresos>('/clientes/ingresos') });
  const d = datos.data;
  const tope = Math.max(1, ...(d?.meses ?? []).map((m) => m.facturado));
  const actual = d?.meses.at(-1);
  return (
    <>
      <div className="kpis">
        <Kpi titulo="Ingreso mensual recurrente" icono="reportes" tono="solido" valor={d ? corto(d.mensualActual) : '—'} nota="mensuales + anuales ÷ 12, sin IGV" />
        <Kpi titulo="Facturado este mes" icono="calendario" valor={actual ? corto(actual.facturado) : '—'} nota="sin IGV" />
        <Kpi titulo="Cobrado este mes" icono="check" valor={actual ? corto(actual.cobrado) : '—'} nota="sin IGV" />
        <Kpi titulo="Últimos 12 meses" icono="resumen" valor={d ? corto(d.meses.reduce((t, m) => t + m.facturado, 0)) : '—'} nota="facturado, sin IGV" />
      </div>

      <div className="card">
        <strong>Facturado y cobrado por mes</strong>
        <p className="meta">Sin IGV, en soles. Barra clara: facturado; oscura: cobrado.</p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, marginTop: 12 }}>
          {d?.meses.map((m) => (
            <div key={m.mes} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }} title={`${nombreMes(m.mes)}: facturado ${corto(m.facturado)}, cobrado ${corto(m.cobrado)}`}>
              <div style={{ width: '100%', maxWidth: 34, height: `${(m.facturado / tope) * 100}%`, minHeight: m.facturado ? 2 : 0, background: 'var(--azul-suave)', borderRadius: 4, position: 'relative' }}>
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: m.facturado ? `${(m.cobrado / m.facturado) * 100}%` : 0, background: 'var(--azul)', borderRadius: 4 }} />
              </div>
              <span className="meta" style={{ fontSize: 11 }}>{MESES[Number(m.mes.slice(5, 7)) - 1]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <strong>Por servicio (últimos 12 meses)</strong>
        {d && d.porServicio.length === 0 && <p className="meta">Todavía no hay cobros.</p>}
        {d && d.porServicio.length > 0 && (
          <table className="tabla" style={{ marginTop: 8 }}>
            <tbody>
              {d.porServicio.map((s) => (
                <tr key={s.servicio}>
                  <td>{s.servicio}</td>
                  <td style={{ textAlign: 'right' }}>{corto(s.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {d && d.enDolares > 0 && <p className="meta" style={{ marginTop: 8 }}>Además, en dólares: {dinero(d.enDolares, 'USD')} (no sumado arriba).</p>}
      </div>
    </>
  );
}
