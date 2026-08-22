import { z } from 'zod';

/**
 * Esquema de un formulario, definido en el CRM y consumido por el conector de WordPress.
 *
 * La clave del diseño es `semantic`: el CRM declara qué ES cada campo, así que el conector
 * no tiene que mapear nada. Es lo que elimina el mapeo frágil "form-field-xxxxx" que hizo
 * doloroso el conector de Sperant.
 */

export const fieldSemantic = z.enum([
  'fname',
  'lname',
  'email',
  'phone',
  'document',
  'message',
  'unit_interest',
  'project_interest',
  'custom',
]);
export type FieldSemantic = z.infer<typeof fieldSemantic>;

export const fieldType = z.enum([
  'text',
  'email',
  'tel',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'number',
  'hidden',
]);
export type FieldType = z.infer<typeof fieldType>;

/** Origen dinámico de opciones: el select se llena con datos vivos del CRM. */
export const dynamicSource = z.object({
  type: z.enum(['units', 'typologies', 'projects']),
  projectId: z.string().optional(),
  onlyAvailable: z.boolean().default(true),
  excludeKinds: z.array(z.string()).default(['estacionamiento', 'deposito']),
});
export type DynamicSource = z.infer<typeof dynamicSource>;

export const formField = z.object({
  key: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/i, 'solo letras, números y guion bajo'),
  semantic: fieldSemantic.default('custom'),
  type: fieldType,
  label: z.string().min(1),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  source: dynamicSource.optional(),
  maxLength: z.number().int().positive().optional(),
  defaultValue: z.string().optional(),
});
export type FormField = z.infer<typeof formField>;

export const formConsent = z.object({
  required: z.boolean().default(true),
  /** Se versiona porque hay que guardar QUÉ texto aceptó el titular (Ley 29733). */
  version: z.string().min(1),
  text: z.string().min(1),
  policyUrl: z.string().url().optional(),
});

export const formAntispam = z.object({
  honeypot: z.boolean().default(true),
  minSeconds: z.number().int().min(0).max(60).default(3),
  turnstile: z.boolean().default(false),
  turnstileSiteKey: z.string().optional(),
});

export const formSuccess = z.object({
  type: z.enum(['message', 'redirect']).default('message'),
  value: z.string().min(1),
});

export const formSchema = z.object({
  name: z.string().min(1),
  submitLabel: z.string().default('Enviar'),
  fields: z.array(formField).min(1),
  consent: formConsent,
  antispam: formAntispam.default({ honeypot: true, minSeconds: 3, turnstile: false }),
  success: formSuccess,
});
export type FormSchema = z.infer<typeof formSchema>;

/** Lo que el conector recibe en GET /api/v1/public/forms/:id */
export interface PublicForm {
  id: string;
  version: number;
  schema: FormSchema;
  /** Opciones ya resueltas para los campos con origen dinámico: { fieldKey: [...] } */
  dynamicOptions: Record<string, { value: string; label: string }[]>;
}
