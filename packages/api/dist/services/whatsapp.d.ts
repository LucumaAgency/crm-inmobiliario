/** El bloque `value` de un cambio con `field: "messages"`. */
export interface ValorMensajes {
    metadata?: {
        phone_number_id?: string;
        display_phone_number?: string;
    };
    contacts?: Array<{
        wa_id?: string;
        profile?: {
            name?: string;
        };
    }>;
    messages?: Array<MensajeEntrante>;
    statuses?: Array<EstadoMensaje>;
}
interface MensajeEntrante {
    id?: string;
    from?: string;
    timestamp?: string;
    type?: string;
    text?: {
        body?: string;
    };
    button?: {
        text?: string;
    };
    interactive?: {
        button_reply?: {
            title?: string;
        };
        list_reply?: {
            title?: string;
        };
    };
    image?: {
        id?: string;
        mime_type?: string;
        caption?: string;
    };
    document?: {
        id?: string;
        mime_type?: string;
        filename?: string;
        caption?: string;
    };
    audio?: {
        id?: string;
        mime_type?: string;
    };
    video?: {
        id?: string;
        mime_type?: string;
        caption?: string;
    };
    location?: {
        latitude?: number;
        longitude?: number;
        name?: string;
    };
    /** Solo en los chats abiertos desde un anuncio Click-to-WhatsApp. */
    referral?: {
        source_url?: string;
        source_id?: string;
        source_type?: string;
        headline?: string;
        body?: string;
        ctwa_clid?: string;
        media_type?: string;
    };
}
interface EstadoMensaje {
    id?: string;
    status?: string;
    timestamp?: string;
    recipient_id?: string;
    errors?: Array<{
        code?: number;
        title?: string;
        message?: string;
    }>;
}
/**
 * Procesa un bloque `messages` del webhook. Se llama dentro de la petición, como el aviso
 * de leadgen: son escrituras locales, no llamadas de red, y dejar el mensaje en la base
 * antes de responder 200 es lo que garantiza que no se pierde si el proceso muere.
 */
export declare function recibirMensajes(valor: ValorMensajes): Promise<void>;
export interface EnvioTexto {
    conversationId: string;
    userId: string;
    text: string;
}
export interface EnvioPlantilla {
    conversationId: string;
    userId: string;
    templateName: string;
    language: string;
    variables?: string[];
}
/** ¿Se puede escribir texto libre ahora mismo? */
export declare function ventanaAbierta(conv: {
    windowExpiresAt: Date | null;
}): boolean;
/**
 * Deja el mensaje en la base y encola el envío.
 *
 * El orden importa: primero la fila, después la llamada a Meta. Al revés, un fallo del
 * proceso entre el envío y el guardado dejaría al cliente con un mensaje que el CRM no
 * sabe que mandó, y el asesor lo repetiría.
 */
export declare function enviarTexto(datos: EnvioTexto): Promise<{
    error: string | null;
    id: string;
    createdAt: Date;
    raw: import("@prisma/client/runtime/library").JsonValue | null;
    status: import(".prisma/client").$Enums.WaMessageStatus;
    type: string;
    direction: import(".prisma/client").$Enums.WaDirection;
    waMessageId: string | null;
    body: string | null;
    media: import("@prisma/client/runtime/library").JsonValue | null;
    templateName: string | null;
    sentAt: Date | null;
    conversationId: string;
    userId: string | null;
}>;
export declare function enviarPlantilla(datos: EnvioPlantilla): Promise<{
    error: string | null;
    id: string;
    createdAt: Date;
    raw: import("@prisma/client/runtime/library").JsonValue | null;
    status: import(".prisma/client").$Enums.WaMessageStatus;
    type: string;
    direction: import(".prisma/client").$Enums.WaDirection;
    waMessageId: string | null;
    body: string | null;
    media: import("@prisma/client/runtime/library").JsonValue | null;
    templateName: string | null;
    sentAt: Date | null;
    conversationId: string;
    userId: string | null;
}>;
/**
 * Envía de verdad. Lo llama la cola.
 *
 * Un 4xx de Meta no se reintenta: el mensaje está mal formado o la plantilla no existe, y
 * repetirlo seis veces solo retrasa que alguien se entere. Los 5xx y los cortes de red sí
 * se propagan para que la cola vuelva a intentarlo.
 */
export declare function despacharMensaje(messageId: string): Promise<void>;
/** Plantillas aprobadas de la cuenta, para poder escribir fuera de la ventana. */
export declare function plantillasDe(phoneNumberId: string): Promise<{
    ok: false;
    error: string;
    templates?: undefined;
} | {
    ok: true;
    templates: unknown[];
    error?: undefined;
}>;
export {};
