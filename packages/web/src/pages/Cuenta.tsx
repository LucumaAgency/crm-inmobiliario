import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const MINIMO = 10;

/**
 * Contraseña propia. Para todos los roles: Ajustes es solo de gestión y un asesor
 * también tiene que poder definir la suya.
 */
export default function Cuenta({ tienePassword }: { tienePassword: boolean }) {
  const qc = useQueryClient();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetida, setRepetida] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const guardar = useMutation({
    mutationFn: () =>
      api.post('/auth/password', { actual: tienePassword ? actual : undefined, nueva }),
    onSuccess: () => {
      setActual('');
      setNueva('');
      setRepetida('');
      setAviso(null);
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    guardar.reset();
    if (nueva.length < MINIMO) return setAviso(`Mínimo ${MINIMO} caracteres.`);
    if (nueva !== repetida) return setAviso('Las dos contraseñas no coinciden.');
    setAviso(null);
    guardar.mutate();
  }

  return (
    <div className="card" style={{ maxWidth: 440 }}>
      <strong>{tienePassword ? 'Cambiar contraseña' : 'Crear contraseña'}</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        {tienePassword
          ? 'Para cambiarla necesitas la actual.'
          : 'Aún no tienes contraseña: entras solo con enlace al correo. Crea una para entrar directo.'}
      </p>
      <form onSubmit={enviar}>
        {tienePassword && (
          <>
            <label htmlFor="actual">Contraseña actual</label>
            <input
              id="actual"
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              autoComplete="current-password"
              required
            />
          </>
        )}
        <label htmlFor="nueva">Nueva contraseña</label>
        <input
          id="nueva"
          type="password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          autoComplete="new-password"
          minLength={MINIMO}
          required
        />
        <label htmlFor="repetida">Repite la nueva</label>
        <input
          id="repetida"
          type="password"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          autoComplete="new-password"
          required
        />
        <button className="btn" style={{ marginTop: 16 }} disabled={guardar.isPending}>
          {guardar.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
      {aviso && <p className="error">{aviso}</p>}
      {guardar.isError && <p className="error">{(guardar.error as Error).message}</p>}
      {guardar.isSuccess && <p className="ok">Contraseña guardada.</p>}
    </div>
  );
}
