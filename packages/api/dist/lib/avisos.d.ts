/**
 * Correos de «Avisar a» por defecto: el de quien conecta la página o crea el formulario.
 *
 * Sin esto, un cliente que conecta su página sin llenar el campo y sin asesores con rol
 * `asesor` (el reparto solo elige entre ellos) recibía leads sin aviso a nadie.
 *
 * Excepción: una cuenta de Lucuma que configura el CRM de un cliente no se pone a sí misma.
 * Los avisos llevan nombre y teléfono del interesado, y esos datos son del cliente
 * (Ley 29733), igual que la regla de la cobranza en services/clientes.ts.
 */
export declare function correosAvisoPorDefecto(userId: string): Promise<string[]>;
/** `notifyEmails` vacío o nulo (columna JSON). */
export declare function sinCorreos(valor: unknown): boolean;
