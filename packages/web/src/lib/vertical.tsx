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
