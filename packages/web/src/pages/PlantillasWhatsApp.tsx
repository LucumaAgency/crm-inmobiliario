/**
 * Plantillas de WhatsApp de cada número conectado, solo lectura.
 *
 * Las plantillas se crean y editan en el Administrador de WhatsApp de Meta, no aquí: la
 * revisión y los rechazos se entienden mejor en su panel, y con tres plantillas por cliente
 * no compensa construir un editor. Lo que sí hacía falta es VERLAS desde el CRM: hasta ahora
 * solo aparecían en el desplegable de la ficha, y solo cuando la ventana de 24 h estaba
 * cerrada. El gerente no tenía forma de saber cuáles existen ni si Meta las aprobó.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Componente {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  format?: string;
  text?: string;
  buttons?: { type: string; text: string }[];
}

interface Plantilla {
  id?: string;
  name: string;
  status: string;
  language: string;
  category: string;
  components?: Componente[];
  rejected_reason?: string;
}

interface Numero { id: string; displayNumber: string; wabaId: string; active: boolean }

const ESTADO: Record<string, { texto: string; clase: string }> = {
  APPROVED: { texto: 'Aprobada', clase: 'chip chip-verde' },
  PENDING: { texto: 'En revisión', clase: 'chip chip-alerta' },
  REJECTED: { texto: 'Rechazada', clase: 'chip chip-rojo' },
  PAUSED: { texto: 'Pausada', clase: 'chip chip-gris' },
  DISABLED: { texto: 'Deshabilitada', clase: 'chip chip-gris' },
};

const CATEGORIA: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
};

function Cuerpo({ p }: { p: Plantilla }) {
  const body = p.components?.find((c) => c.type === 'BODY')?.text;
  const header = p.components?.find((c) => c.type === 'HEADER');
  const footer = p.components?.find((c) => c.type === 'FOOTER')?.text;
  const botones = p.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? [];
  const variables = (body?.match(/\{\{\d+\}\}/g) ?? []).length;
  return (
    <div className="plantilla-cuerpo">
      {header && <div className="meta">{header.format === 'TEXT' ? header.text : `Encabezado: ${header.format?.toLowerCase()}`}</div>}
      {body ? <div style={{ whiteSpace: 'pre-wrap' }}>{body}</div> : <span className="meta">Sin texto</span>}
      {footer && <div className="meta">{footer}</div>}
      {botones.length > 0 && (
        <div className="meta">Botones: {botones.map((b) => b.text).join(' · ')}</div>
      )}
      {variables > 0 && (
        <div className="meta">
          {variables === 1 ? '1 variable' : `${variables} variables`} que el asesor completa al enviar
        </div>
      )}
    </div>
  );
}

function PlantillasDeNumero({ numero }: { numero: Numero }) {
  const q = useQuery({
    queryKey: ['wa-templates', numero.id],
    queryFn: () => api.get<{ ok: boolean; templates?: Plantilla[]; error?: string }>(`/whatsapp/numbers/${numero.id}/templates`),
    staleTime: 60_000,
  });

  const lista = (q.data?.templates ?? []).slice().sort((a, b) => {
    const orden = ['APPROVED', 'PENDING', 'REJECTED'];
    return orden.indexOf(a.status) - orden.indexOf(b.status) || a.name.localeCompare(b.name);
  });

  return (
    <div style={{ marginTop: 14 }}>
      <div className="fila">
        <span className="nombre">{numero.displayNumber}</span>
        <a
          className="btn btn-sec"
          style={{ padding: '5px 10px', fontSize: 12 }}
          href={`https://business.facebook.com/wa/manage/message-templates/?waba_id=${numero.wabaId}`}
          target="_blank"
          rel="noreferrer"
        >
          Crear o editar en Meta
        </a>
      </div>

      {q.isLoading && <p className="meta">Consultando a Meta…</p>}
      {q.data && !q.data.ok && <p className="error">No se pudieron traer las plantillas: {q.data.error}</p>}
      {q.data?.ok && lista.length === 0 && (
        <p className="meta" style={{ marginTop: 6 }}>
          Este número no tiene plantillas. Sin al menos una aprobada, el asesor no puede escribirle
          primero a un lead ni retomar un chat con la ventana de 24 horas cerrada.
        </p>
      )}

      {lista.length > 0 && (
        <table className="tabla tabla-movil" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Idioma</th>
              <th>Estado</th>
              <th>Texto</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const estado = ESTADO[p.status] ?? { texto: p.status, clase: 'chip chip-gris' };
              return (
                <tr key={`${p.name}-${p.language}`}>
                  <td data-label="Nombre" className="t-titulo"><code>{p.name}</code></td>
                  <td data-label="Categoría">{CATEGORIA[p.category] ?? p.category}</td>
                  <td data-label="Idioma">{p.language}</td>
                  <td data-label="Estado">
                    <span className={estado.clase}>{estado.texto}</span>
                    {p.status === 'REJECTED' && p.rejected_reason && (
                      <div className="meta">{p.rejected_reason.replace(/_/g, ' ').toLowerCase()}</div>
                    )}
                  </td>
                  <td data-label="Texto"><Cuerpo p={p} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function PlantillasWhatsApp() {
  const numeros = useQuery({ queryKey: ['wa-numbers'], queryFn: () => api.get<Numero[]>('/whatsapp/numbers') });
  const lista = numeros.data ?? [];

  return (
    <div className="card">
      <strong>Plantillas de mensaje</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Son los mensajes prearmados que Meta aprueba para escribirle primero a alguien o retomar
        un chat pasadas 24 horas sin respuesta del cliente. Se crean en el Administrador de
        WhatsApp de Meta; aquí aparecen solas en cuanto existen. Responder dentro de la ventana
        no necesita plantilla y no se cobra; cada plantilla enviada cuesta centavos según su
        categoría.
      </p>
      <p className="meta">
        Para arrancar bastan tres: <strong>primer contacto</strong> a un lead cargado a mano,
        <strong> recordatorio de visita</strong> y <strong>envío de cotización</strong>. Las dos
        últimas suelen aprobarse como Utilidad, la más barata.
      </p>

      {numeros.isLoading && <p className="meta">Cargando…</p>}
      {numeros.data && lista.length === 0 && (
        <p className="meta">Todavía no hay ningún número conectado. Conéctalo arriba y las plantillas aparecerán aquí.</p>
      )}
      {lista.map((n) => <PlantillasDeNumero key={n.id} numero={n} />)}
    </div>
  );
}
