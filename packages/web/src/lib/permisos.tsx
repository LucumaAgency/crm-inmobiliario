import { createContext, useContext } from 'react';
import type { Permiso } from '@lucuma-crm/shared';

/**
 * Permisos del usuario en sesión, disponibles en cualquier componente.
 *
 * La interfaz esconde lo que no se puede hacer; el servidor es quien lo impide. Por eso aquí
 * no hay lógica: solo se pregunta `puede('leads.editar')` y se pinta o no el botón.
 */
export const PermisosContext = createContext<Permiso[]>([]);

export function usePermisos() {
  return useContext(PermisosContext);
}

export function usePuede() {
  const permisos = useContext(PermisosContext);
  return (...p: Permiso[]) => p.some((x) => permisos.includes(x));
}
