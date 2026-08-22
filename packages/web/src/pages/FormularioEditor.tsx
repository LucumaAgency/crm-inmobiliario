import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FormField, FormSchema } from '@lucuma-crm/shared';
import { api } from '../lib/api.js';

/**
 * Constructor de formularios.
 *
 * Lo importante de cada campo es `semantic`: el CRM declara QUÉ es cada campo, así que el
 * conector de WordPress no tiene que mapear nada. Es lo que elimina el mapeo frágil
 * "form-field-xxxxx" que hizo doloroso el conector de Sperant.
 */

const SEMANTICOS = [
  ['fname', 'Nombre'],
  ['lname', 'Apellido'],
  ['email', 'Correo'],
  ['phone', 'Teléfono'],
  ['document', 'Documento'],
  ['message', 'Mensaje'],
  ['unit_interest', 'Unidad de interés'],
  ['project_interest', 'Proyecto de interés'],
  ['custom', 'Personalizado'],
] as const;

const TIPOS = ['text', 'email', 'tel', 'textarea', 'select', 'radio', 'checkbox', 'number', 'hidden'] as const;

const VACIO: FormSchema = {
  name: 'Nuevo formulario',
  submitLabel: 'Enviar',
  fields: [
    { key: 'fname', semantic: 'fname', type: 'text', label: 'Nombre', required: true },
    { key: 'phone', semantic: 'phone', type: 'tel', label: 'Teléfono', required: true },
    { key: 'email', semantic: 'email', type: 'email', label: 'Correo', required: true },
  ],
  consent: {
    required: true,
    version: '2026-08',
    text: 'Autorizo el tratamiento de mis datos personales conforme a la Política de Privacidad.',
  },
  antispam: { honeypot: true, minSeconds: 3, turnstile: false },
  success: { type: 'message', value: 'Gracias. Un asesor te contactará pronto.' },
};

export default function FormularioEditor() {
  const { id } = useParams();
  const nuevo = id === 'nuevo';
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [schema, setSchema] = useState<FormSchema>(VACIO);
  const [projectId, setProjectId] = useState('');
  const [notify, setNotify] = useState('');
  const [error, setError] = useState<string | null>(null);

  const proyectos = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/projects'),
  });

  const existente = useQuery({
    queryKey: ['form', id],
    queryFn: () => api.get<{ schema: FormSchema; projectId: string | null; notifyEmails: string[] }>(`/forms/${id}`),
    enabled: !nuevo,
  });

  useEffect(() => {
    if (existente.data) {
      setSchema(existente.data.schema);
      setProjectId(existente.data.projectId ?? '');
      setNotify((existente.data.notifyEmails ?? []).join(', '));
    }
  }, [existente.data]);

  const guardar = useMutation({
    mutationFn: () => {
      const body = {
        name: schema.name,
        projectId: projectId || null,
        notifyEmails: notify.split(',').map((s) => s.trim()).filter(Boolean),
        schema,
      };
      return nuevo ? api.post<{ id: string }>('/forms', body) : api.put<{ id: string }>(`/forms/${id}`, body);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['forms'] });
      navigate(`/formularios/${res.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  function actualizarCampo(i: number, patch: Partial<FormField>) {
    setSchema((s) => ({ ...s, fields: s.fields.map((f, j) => (i === j ? { ...f, ...patch } : f)) }));
  }

  function agregarCampo() {
    setSchema((s) => ({
      ...s,
      fields: [
        ...s.fields,
        { key: `campo_${s.fields.length + 1}`, semantic: 'custom', type: 'text', label: 'Nuevo campo', required: false },
      ],
    }));
  }

  function quitarCampo(i: number) {
    setSchema((s) => ({ ...s, fields: s.fields.filter((_, j) => j !== i) }));
  }

  return (
    <>
      <div className="card">
        <label>Nombre del formulario</label>
        <input value={schema.name} onChange={(e) => setSchema({ ...schema, name: e.target.value })} />

        <label>Proyecto</label>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Sin proyecto</option>
          {proyectos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <label>Avisar por correo a</label>
        <input value={notify} onChange={(e) => setNotify(e.target.value)} placeholder="ventas@cliente.com, gerencia@cliente.com" />

        <label>Texto del botón</label>
        <input value={schema.submitLabel} onChange={(e) => setSchema({ ...schema, submitLabel: e.target.value })} />
      </div>

      <div className="card">
        <div className="fila">
          <strong>Campos</strong>
          <button className="btn btn-sec" onClick={agregarCampo}>Agregar campo</button>
        </div>
        <p className="meta" style={{ marginTop: 6 }}>
          El tipo semántico es lo que el CRM entiende. El conector no mapea nada: usa esto.
        </p>

        {schema.fields.map((f, i) => (
          <div key={i} className="card" style={{ background: '#fafbfc', marginTop: 10 }}>
            <div className="fila">
              <input
                value={f.label}
                onChange={(e) => actualizarCampo(i, { label: e.target.value })}
                placeholder="Etiqueta"
              />
              <button className="btn btn-sec" onClick={() => quitarCampo(i)} title="Quitar">✕</button>
            </div>

            <label>Clave interna</label>
            <input value={f.key} onChange={(e) => actualizarCampo(i, { key: e.target.value })} />

            <label>Qué es este campo</label>
            <select
              value={f.semantic}
              onChange={(e) => actualizarCampo(i, { semantic: e.target.value as FormField['semantic'] })}
            >
              {SEMANTICOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>

            <label>Tipo de control</label>
            <select
              value={f.type}
              onChange={(e) => actualizarCampo(i, { type: e.target.value as FormField['type'] })}
            >
              {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>

            {f.semantic === 'unit_interest' && (
              <p className="meta" style={{ marginTop: 8 }}>
                Este campo se llena solo con las unidades disponibles del proyecto. No hay que
                escribir las opciones a mano ni actualizarlas cuando se vende un departamento.
              </p>
            )}

            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                style={{ width: 'auto' }}
                checked={f.required}
                onChange={(e) => actualizarCampo(i, { required: e.target.checked })}
              />
              Obligatorio
            </label>
          </div>
        ))}
      </div>

      <div className="card">
        <strong>Consentimiento (Ley 29733)</strong>
        <p className="meta" style={{ marginTop: 6 }}>
          El checkbox va sin premarcar y separado del botón de envío. Se guarda con cada lead
          qué versión del texto aceptó el titular.
        </p>
        <label>Versión del texto</label>
        <input
          value={schema.consent.version}
          onChange={(e) => setSchema({ ...schema, consent: { ...schema.consent, version: e.target.value } })}
        />
        <label>Texto</label>
        <textarea
          rows={3}
          value={schema.consent.text}
          onChange={(e) => setSchema({ ...schema, consent: { ...schema.consent, text: e.target.value } })}
        />
      </div>

      <div className="card">
        <strong>Mensaje de éxito</strong>
        <input
          value={schema.success.value}
          onChange={(e) => setSchema({ ...schema, success: { ...schema.success, value: e.target.value } })}
        />
      </div>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-bloque" onClick={() => guardar.mutate()} disabled={guardar.isPending}>
        {guardar.isPending ? 'Guardando…' : 'Guardar formulario'}
      </button>
      {!nuevo && (
        <p className="meta" style={{ marginTop: 10 }}>
          Al guardar sube la versión del formulario, y eso invalida la caché del conector en el sitio.
        </p>
      )}
    </>
  );
}
