import { interpretar } from './whatsapp.js';
type MensajeMeta = Parameters<typeof interpretar>[0];
interface Metadata {
    phone_number_id?: string;
    display_phone_number?: string;
}
interface Eco extends MensajeMeta {
    to?: string;
    to_user_id?: string;
    revoke?: {
        original_message_id?: string;
    };
    edit?: {
        original_message_id?: string;
        message?: MensajeMeta;
    };
}
export interface ValorEcos {
    metadata?: Metadata;
    message_echoes?: Eco[];
}
interface MensajeHistorial extends MensajeMeta {
    to?: string;
    history_context?: {
        status?: string;
    };
}
export interface ValorHistorial {
    metadata?: Metadata;
    history?: Array<{
        metadata?: {
            phase?: number;
            chunk_order?: number;
            progress?: number;
        };
        threads?: Array<{
            id?: string;
            context?: {
                wa_id?: string;
                user_id?: string;
            };
            messages?: MensajeHistorial[];
        }>;
        errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
        }>;
    }>;
    /** Contenido de archivos del historial: llega aparte, con el mismo `id` del mensaje. */
    messages?: MensajeHistorial[];
}
export interface ValorContactos {
    metadata?: Metadata;
    state_sync?: Array<{
        type?: string;
        action?: string;
        contact?: {
            full_name?: string;
            first_name?: string;
            phone_number?: string;
            user_id?: string;
        };
    }>;
}
export interface ValorCuenta {
    event?: string;
    waba_info?: {
        waba_id?: string;
    };
    disconnection_info?: {
        reason?: string;
        initiated_by?: string;
    };
}
export declare function recibirEcos(valor: ValorEcos): Promise<void>;
export declare function recibirHistorial(valor: ValorHistorial): Promise<void>;
export declare function recibirContactos(valor: ValorContactos): Promise<void>;
/** `wabaIdEntrada` es el `entry.id` del aviso: la WABA, cuando el evento no trae `waba_info`. */
export declare function recibirCuenta(wabaIdEntrada: string | undefined, valor: ValorCuenta): Promise<void>;
export {};
