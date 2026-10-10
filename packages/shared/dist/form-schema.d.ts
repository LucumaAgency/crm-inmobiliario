import { z } from 'zod';
/**
 * Esquema de un formulario, definido en el CRM y consumido por el conector de WordPress.
 *
 * La clave del diseño es `semantic`: el CRM declara qué ES cada campo, así que el conector
 * no tiene que mapear nada. Es lo que elimina el mapeo frágil "form-field-xxxxx" que hizo
 * doloroso el conector de Sperant.
 */
export declare const fieldSemantic: z.ZodEnum<["fname", "lname", "email", "phone", "document", "message", "unit_interest", "project_interest", "custom"]>;
export type FieldSemantic = z.infer<typeof fieldSemantic>;
export declare const fieldType: z.ZodEnum<["text", "email", "tel", "textarea", "select", "radio", "checkbox", "number", "hidden"]>;
export type FieldType = z.infer<typeof fieldType>;
/** Origen dinámico de opciones: el select se llena con datos vivos del CRM. */
export declare const dynamicSource: z.ZodObject<{
    type: z.ZodEnum<["units", "typologies", "projects"]>;
    projectId: z.ZodOptional<z.ZodString>;
    onlyAvailable: z.ZodDefault<z.ZodBoolean>;
    excludeKinds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    type: "units" | "typologies" | "projects";
    onlyAvailable: boolean;
    excludeKinds: string[];
    projectId?: string | undefined;
}, {
    type: "units" | "typologies" | "projects";
    projectId?: string | undefined;
    onlyAvailable?: boolean | undefined;
    excludeKinds?: string[] | undefined;
}>;
export type DynamicSource = z.infer<typeof dynamicSource>;
export declare const formField: z.ZodObject<{
    key: z.ZodString;
    semantic: z.ZodDefault<z.ZodEnum<["fname", "lname", "email", "phone", "document", "message", "unit_interest", "project_interest", "custom"]>>;
    type: z.ZodEnum<["text", "email", "tel", "textarea", "select", "radio", "checkbox", "number", "hidden"]>;
    label: z.ZodString;
    placeholder: z.ZodOptional<z.ZodString>;
    help: z.ZodOptional<z.ZodString>;
    required: z.ZodDefault<z.ZodBoolean>;
    options: z.ZodOptional<z.ZodArray<z.ZodObject<{
        value: z.ZodString;
        label: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        label: string;
    }, {
        value: string;
        label: string;
    }>, "many">>;
    source: z.ZodOptional<z.ZodObject<{
        type: z.ZodEnum<["units", "typologies", "projects"]>;
        projectId: z.ZodOptional<z.ZodString>;
        onlyAvailable: z.ZodDefault<z.ZodBoolean>;
        excludeKinds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        type: "units" | "typologies" | "projects";
        onlyAvailable: boolean;
        excludeKinds: string[];
        projectId?: string | undefined;
    }, {
        type: "units" | "typologies" | "projects";
        projectId?: string | undefined;
        onlyAvailable?: boolean | undefined;
        excludeKinds?: string[] | undefined;
    }>>;
    maxLength: z.ZodOptional<z.ZodNumber>;
    defaultValue: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
    key: string;
    semantic: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest";
    label: string;
    required: boolean;
    options?: {
        value: string;
        label: string;
    }[] | undefined;
    placeholder?: string | undefined;
    help?: string | undefined;
    source?: {
        type: "units" | "typologies" | "projects";
        onlyAvailable: boolean;
        excludeKinds: string[];
        projectId?: string | undefined;
    } | undefined;
    maxLength?: number | undefined;
    defaultValue?: string | undefined;
}, {
    type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
    key: string;
    label: string;
    options?: {
        value: string;
        label: string;
    }[] | undefined;
    semantic?: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest" | undefined;
    placeholder?: string | undefined;
    help?: string | undefined;
    required?: boolean | undefined;
    source?: {
        type: "units" | "typologies" | "projects";
        projectId?: string | undefined;
        onlyAvailable?: boolean | undefined;
        excludeKinds?: string[] | undefined;
    } | undefined;
    maxLength?: number | undefined;
    defaultValue?: string | undefined;
}>;
export type FormField = z.infer<typeof formField>;
export declare const formConsent: z.ZodObject<{
    required: z.ZodDefault<z.ZodBoolean>;
    /** Se versiona porque hay que guardar QUÉ texto aceptó el titular (Ley 29733). */
    version: z.ZodString;
    text: z.ZodString;
    policyUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    version: string;
    text: string;
    required: boolean;
    policyUrl?: string | undefined;
}, {
    version: string;
    text: string;
    required?: boolean | undefined;
    policyUrl?: string | undefined;
}>;
export declare const formAntispam: z.ZodObject<{
    honeypot: z.ZodDefault<z.ZodBoolean>;
    minSeconds: z.ZodDefault<z.ZodNumber>;
    turnstile: z.ZodDefault<z.ZodBoolean>;
    turnstileSiteKey: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    honeypot: boolean;
    minSeconds: number;
    turnstile: boolean;
    turnstileSiteKey?: string | undefined;
}, {
    honeypot?: boolean | undefined;
    minSeconds?: number | undefined;
    turnstile?: boolean | undefined;
    turnstileSiteKey?: string | undefined;
}>;
export declare const formSuccess: z.ZodObject<{
    type: z.ZodDefault<z.ZodEnum<["message", "redirect"]>>;
    value: z.ZodString;
}, "strip", z.ZodTypeAny, {
    value: string;
    type: "message" | "redirect";
}, {
    value: string;
    type?: "message" | "redirect" | undefined;
}>;
export declare const formSchema: z.ZodObject<{
    name: z.ZodString;
    submitLabel: z.ZodDefault<z.ZodString>;
    fields: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        semantic: z.ZodDefault<z.ZodEnum<["fname", "lname", "email", "phone", "document", "message", "unit_interest", "project_interest", "custom"]>>;
        type: z.ZodEnum<["text", "email", "tel", "textarea", "select", "radio", "checkbox", "number", "hidden"]>;
        label: z.ZodString;
        placeholder: z.ZodOptional<z.ZodString>;
        help: z.ZodOptional<z.ZodString>;
        required: z.ZodDefault<z.ZodBoolean>;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            value: z.ZodString;
            label: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            value: string;
            label: string;
        }, {
            value: string;
            label: string;
        }>, "many">>;
        source: z.ZodOptional<z.ZodObject<{
            type: z.ZodEnum<["units", "typologies", "projects"]>;
            projectId: z.ZodOptional<z.ZodString>;
            onlyAvailable: z.ZodDefault<z.ZodBoolean>;
            excludeKinds: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        }, "strip", z.ZodTypeAny, {
            type: "units" | "typologies" | "projects";
            onlyAvailable: boolean;
            excludeKinds: string[];
            projectId?: string | undefined;
        }, {
            type: "units" | "typologies" | "projects";
            projectId?: string | undefined;
            onlyAvailable?: boolean | undefined;
            excludeKinds?: string[] | undefined;
        }>>;
        maxLength: z.ZodOptional<z.ZodNumber>;
        defaultValue: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
        key: string;
        semantic: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest";
        label: string;
        required: boolean;
        options?: {
            value: string;
            label: string;
        }[] | undefined;
        placeholder?: string | undefined;
        help?: string | undefined;
        source?: {
            type: "units" | "typologies" | "projects";
            onlyAvailable: boolean;
            excludeKinds: string[];
            projectId?: string | undefined;
        } | undefined;
        maxLength?: number | undefined;
        defaultValue?: string | undefined;
    }, {
        type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
        key: string;
        label: string;
        options?: {
            value: string;
            label: string;
        }[] | undefined;
        semantic?: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest" | undefined;
        placeholder?: string | undefined;
        help?: string | undefined;
        required?: boolean | undefined;
        source?: {
            type: "units" | "typologies" | "projects";
            projectId?: string | undefined;
            onlyAvailable?: boolean | undefined;
            excludeKinds?: string[] | undefined;
        } | undefined;
        maxLength?: number | undefined;
        defaultValue?: string | undefined;
    }>, "many">;
    consent: z.ZodObject<{
        required: z.ZodDefault<z.ZodBoolean>;
        /** Se versiona porque hay que guardar QUÉ texto aceptó el titular (Ley 29733). */
        version: z.ZodString;
        text: z.ZodString;
        policyUrl: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: string;
        text: string;
        required: boolean;
        policyUrl?: string | undefined;
    }, {
        version: string;
        text: string;
        required?: boolean | undefined;
        policyUrl?: string | undefined;
    }>;
    antispam: z.ZodDefault<z.ZodObject<{
        honeypot: z.ZodDefault<z.ZodBoolean>;
        minSeconds: z.ZodDefault<z.ZodNumber>;
        turnstile: z.ZodDefault<z.ZodBoolean>;
        turnstileSiteKey: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        honeypot: boolean;
        minSeconds: number;
        turnstile: boolean;
        turnstileSiteKey?: string | undefined;
    }, {
        honeypot?: boolean | undefined;
        minSeconds?: number | undefined;
        turnstile?: boolean | undefined;
        turnstileSiteKey?: string | undefined;
    }>>;
    success: z.ZodObject<{
        type: z.ZodDefault<z.ZodEnum<["message", "redirect"]>>;
        value: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        value: string;
        type: "message" | "redirect";
    }, {
        value: string;
        type?: "message" | "redirect" | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    consent: {
        version: string;
        text: string;
        required: boolean;
        policyUrl?: string | undefined;
    };
    antispam: {
        honeypot: boolean;
        minSeconds: number;
        turnstile: boolean;
        turnstileSiteKey?: string | undefined;
    };
    success: {
        value: string;
        type: "message" | "redirect";
    };
    name: string;
    submitLabel: string;
    fields: {
        type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
        key: string;
        semantic: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest";
        label: string;
        required: boolean;
        options?: {
            value: string;
            label: string;
        }[] | undefined;
        placeholder?: string | undefined;
        help?: string | undefined;
        source?: {
            type: "units" | "typologies" | "projects";
            onlyAvailable: boolean;
            excludeKinds: string[];
            projectId?: string | undefined;
        } | undefined;
        maxLength?: number | undefined;
        defaultValue?: string | undefined;
    }[];
}, {
    consent: {
        version: string;
        text: string;
        required?: boolean | undefined;
        policyUrl?: string | undefined;
    };
    success: {
        value: string;
        type?: "message" | "redirect" | undefined;
    };
    name: string;
    fields: {
        type: "number" | "text" | "email" | "tel" | "textarea" | "select" | "radio" | "checkbox" | "hidden";
        key: string;
        label: string;
        options?: {
            value: string;
            label: string;
        }[] | undefined;
        semantic?: "message" | "custom" | "email" | "fname" | "lname" | "phone" | "document" | "unit_interest" | "project_interest" | undefined;
        placeholder?: string | undefined;
        help?: string | undefined;
        required?: boolean | undefined;
        source?: {
            type: "units" | "typologies" | "projects";
            projectId?: string | undefined;
            onlyAvailable?: boolean | undefined;
            excludeKinds?: string[] | undefined;
        } | undefined;
        maxLength?: number | undefined;
        defaultValue?: string | undefined;
    }[];
    antispam?: {
        honeypot?: boolean | undefined;
        minSeconds?: number | undefined;
        turnstile?: boolean | undefined;
        turnstileSiteKey?: string | undefined;
    } | undefined;
    submitLabel?: string | undefined;
}>;
export type FormSchema = z.infer<typeof formSchema>;
/** Lo que el conector recibe en GET /api/v1/public/forms/:id */
export interface PublicForm {
    id: string;
    version: number;
    schema: FormSchema;
    /** Opciones ya resueltas para los campos con origen dinámico: { fieldKey: [...] } */
    dynamicOptions: Record<string, {
        value: string;
        label: string;
    }[]>;
}
