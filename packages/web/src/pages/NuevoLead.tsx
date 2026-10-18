import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import SelectorInteres from '../components/SelectorInteres.js';
import { useEtiquetas } from '../lib/vertical.js';
import { REDES, type CampoRed } from '@lucuma-crm/shared';

interface Props {
  onCerrar: () => void;
}

interface Proyecto { id: string; name: string }

/**
 * Alta manual de un lead.
 *
 * No es solo una utilidad de pruebas: es la fuente "manual" de `docs/05-CAPTURA-LEADS.md`.
 * El asesor recibe una llamada o alguien llega a la caseta de ventas, y tiene que poder
 * registrarlo sin salir del CRM. Entra por la misma puerta que el formulario web
 * (`captureLead`), así que hereda deduplicación, asignación y SLA.
 */
export default function NuevoLead({ onCerrar }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const L = useEtiquetas();

  const [fname, setFname] = useState('');
  const [lname, setLname] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [document, setDocument] = useState('');
  const [projectId, setProjectId] = useState('');
  const [message, setMessage] = useState('');
  const [typologyIds, setTypologyIds] = useState<string[]>([]);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [redes, setRedes] = useState<Partial<Record<CampoRed, string>>>({});

  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Proyecto[]>('/projects'),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post<{ leadId: string; duplicated: boolean }>('/leads', {
        fname: fname.trim(),
        lname: lname.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        document: document.trim() || undefined,
        message: message.trim() || undefined,
        projectId,
        redes,
        typologyIds: projectId && typologyIds.length ? typologyIds : undefined,
        unitIds: projectId && unitIds.length ? unitIds : undefined,
        source: 'manual',
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      onCerrar();
      navigate(`/leads/${r.leadId}`);
    },
  });

  // Obligatorios: nombre y proyecto (servicio en la agencia). Sin teléfono ni correo no hay
  // clave de identidad y no se reconoce a la persona si vuelve; se avisa, pero no se exige:
  // hay leads que solo dejan su Instagram.
  const sinIdentidad = !phone.trim() && !email.trim();
  const invalido = !fname.trim() || !projectId;

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>Nuevo lead</h2>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalido) crear.mutate();
          }}
        >
          <div className="rejilla-2">
            <div>
              <label htmlFor="nl-fname">Nombre *</label>
              <input id="nl-fname" value={fname} onChange={(e) => setFname(e.target.value)} autoFocus />
            </div>
            <div>
              <label htmlFor="nl-lname">Apellido</label>
              <input id="nl-lname" value={lname} onChange={(e) => setLname(e.target.value)} />
            </div>
          </div>

          <div className="rejilla-2">
            <div>
              <label htmlFor="nl-phone">Teléfono</label>
              <input
                id="nl-phone"
                inputMode="tel"
                placeholder="987654321"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="nl-email">Correo</label>
              <input id="nl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <div className="rejilla-2">
            <div>
              <label htmlFor="nl-doc">DNI</label>
              <input id="nl-doc" value={document} onChange={(e) => setDocument(e.target.value)} />
            </div>
            <div>
              <label htmlFor="nl-proy">{L.proyecto} *</label>
              <select
                id="nl-proy"
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setTypologyIds([]);
                  setUnitIds([]);
                }}
              >
                <option value="">Elige…</option>
                {proyectos.data?.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {projectId && (
            <SelectorInteres
              projectId={projectId}
              typologyIds={typologyIds}
              unitIds={unitIds}
              onChange={(v) => { setTypologyIds(v.typologyIds); setUnitIds(v.unitIds); }}
            />
          )}

          <div className="rejilla-2">
            {REDES.map((r) => (
              <div key={r.campo}>
                <label htmlFor={`nl-${r.campo}`}>{r.nombre}</label>
                <input
                  id={`nl-${r.campo}`}
                  placeholder={r.ejemplo}
                  value={redes[r.campo] ?? ''}
                  onChange={(e) => setRedes({ ...redes, [r.campo]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <label htmlFor="nl-msg">Nota</label>
          <textarea
            id="nl-msg"
            rows={3}
            placeholder="Llamó preguntando por…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />

          {sinIdentidad && fname.trim() !== '' && (
            <p className="meta" style={{ marginTop: 10 }}>
              Sin teléfono ni correo se puede crear, pero si la persona vuelve a escribir el CRM no
              la va a reconocer y quedarían dos fichas.
            </p>
          )}
          {crear.isError && <p className="error">{(crear.error as Error).message}</p>}

          <div className="acciones" style={{ marginTop: 16 }}>
            <button type="submit" className="btn" disabled={invalido || crear.isPending}>
              {crear.isPending ? 'Guardando…' : 'Crear lead'}
            </button>
            <button type="button" className="btn btn-sec" onClick={onCerrar}>Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
