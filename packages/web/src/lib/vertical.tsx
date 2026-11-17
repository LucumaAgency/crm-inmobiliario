import { createContext, useContext } from 'react';
import { etiquetas, type Etiquetas, type Vertical } from '@lucuma-crm/shared';

/**
 * Vertical de la organización en sesión y sus etiquetas.
 *
 * Las pantallas comunes preguntan `L.proyecto`, `L.documento`, etc. en vez de escribir
 * «Proyecto» o «Proforma»: así Bastión ve inmobiliaria y Lucuma ve agencia sin dos códigos.
 */
export const VerticalContext = createContext<Vertical>('inmobiliaria');

export function useVertical(): Vertical {
  return useContext(VerticalContext);
}

export function useEtiquetas(): Etiquetas {
  return etiquetas(useContext(VerticalContext));
}

/**
 * Moneda de la organización (`PEN` o `USD`). Decide la moneda de los paquetes nuevos, en qué
 * moneda se muestran los totales de Clientes y si aparece el IGV (solo en soles).
 */
export type Moneda = 'PEN' | 'USD';
export const MonedaContext = createContext<Moneda>('PEN');

export function useMoneda(): Moneda {
  return useContext(MonedaContext);
}

/** «S/» o «US$». */
export function simbolo(moneda: string | null | undefined): string {
  return moneda === 'USD' ? 'US$' : 'S/';
}
