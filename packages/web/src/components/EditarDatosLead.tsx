import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { FUENTES } from '../lib/reportes.js';
import { usePuede } from '../lib/permisos.js';
import { REDES, type CampoRed } from '@lucuma-crm/shared';

export interface DatosLead {
  id: string;
  source: string;
  message: string | null;
  contact: { fname: string; lname: string | null; phone: string | null; email: string | null; document: string | null; documentType?: string | null } & Partial<Record<CampoRed, string | null>>;
  owner: { id: string; name: string } | null;
}

const DOCUMENTOS = { DNI: 'DNI', CE: 'Carné de extranjería', RUC: 'RUC', PAS: 'Pasaporte' };

/**
 * Corregir nombre, teléfono, correo, documento, fuente, mensaje y asesor de un lead.
 *
 * Los datos de la persona son del contacto: si tiene otro lead, el cambio se ve en los dos.
 * El asesor va por la ruta de siempre (PATCH con `ownerId`), que exige `leads.reasignar`.
 */
export default function EditarDatosLead({ lead, onCerrar }: { lead: DatosLead; onCerrar: () => void }) {
  const qc = useQueryClient();
  const puede = usePuede();
  const reasigna = puede('leads.reasignar');
  const [f, setF] = useState({
    fname: lead.contact.fname,
    lname: lead.contact.lname ?? '',
    phone: lead.contact.phone ?? '',
    email: lead.contact.email ?? '',
    documentType: lead.contact.documentType || 'DNI',
    document: lead.contact.document ?? '',
    source: lead.source,
    message: lead.message ?? '',
    ownerId: lead.owner?.id ?? '',
    ...(Object.fromEntries(REDES.map((r) => [r.campo, lead.contact[r.campo] ?? ''])) as Record<CampoRed, string>),
  });
  const campo = (k: keyof typeof f) => ({
    value: f[k],
    onChange: (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value }),
  });

  const usuarios = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ id: string; name: string; active: boolean }[]>('/users'),
    enabled: reasigna,
  });

  const guardar = useMutation({
    mutationFn: async () => {
      await api.put(`/leads/${lead.id}/datos`, {
        fname: f.fname.trim(),
        lname: f.lname,
        phone: f.phone,
        email: f.email,
        documentType: f.documentType,
        document: f.document,
        source: f.source,
        message: f.message,
        ...Object.fromEntries(REDES.map((r) => [r.campo, f[r.campo]])),
      });
      if (reasigna && f.ownerId && f.ownerId !== (lead.owner?.id ?? '')) {
        await api.patch(`/leads/${lead.id}`, { ownerId: f.ownerId });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lead', lead.id] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['tablero'] });
      onCerrar();
    },
  });

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>Editar datos</h2>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (f.fname.trim()) guardar.mutate();
          }}
        >
          <div className="rejilla-2">
            <div>
              <label htmlFor="ed-fname">Nombre *</label>
              <input id="ed-fname" {...campo('fname')} required />
            </div>
            <div>
              <label htmlFor="ed-lname">Apellido</label>
              <input id="ed-lname" {...campo('lname')} />
            </div>
            <div>
              <label htmlFor="ed-phone">Teléfono</label>
              <input id="ed-phone" type="tel" {...campo('phone')} placeholder="987 654 321" />
            </div>
            <div>
              <label htmlFor="ed-email">Correo</label>
              <input id="ed-email" type="email" {...campo('email')} />
            </div>
            <div>
              <label htmlFor="ed-doctype">Tipo de documento</label>
              <select id="ed-doctype" {...campo('documentType')}>
                {Object.entries(DOCUMENTOS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ed-doc">Número de documento</label>
              <input id="ed-doc" {...campo('document')} />
            </div>
            <div>
              <label htmlFor="ed-source">Fuente</label>
              <select id="ed-source" {...campo('source')}>
                {Object.entries(FUENTES).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            {reasigna && (
              <div>
                <label htmlFor="ed-owner">Asesor</label>
                <select id="ed-owner" {...campo('ownerId')}>
                  {!lead.owner && <option value="">Sin asignar</option>}
                  {usuarios.data
                    ?.filter((u) => u.active || u.id === lead.owner?.id)
                    .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="rejilla-2">
            {REDES.map((r) => (
              <div key={r.campo}>
                <label htmlFor={`ed-${r.campo}`}>{r.nombre}</label>
                <input id={`ed-${r.campo}`} placeholder={r.ejemplo} {...campo(r.campo)} />
              </div>
            ))}
          </div>
          <label htmlFor="ed-msg">Mensaje con el que entró</label>
          <textarea id="ed-msg" rows={3} {...campo('message')} />
          <p className="meta" style={{ marginTop: 8 }}>
            Nombre, teléfono, correo, documento y redes son de la persona: si tiene otro lead, el cambio
            también se ve ahí. Lo que cambies queda en las actividades con el valor anterior.
          </p>
          {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
          <div className="acciones">
            <button type="button" className="btn btn-sec" onClick={onCerrar}>Cancelar</button>
            <button type="submit" className="btn" disabled={!f.fname.trim() || guardar.isPending}>
              {guardar.isPending ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
