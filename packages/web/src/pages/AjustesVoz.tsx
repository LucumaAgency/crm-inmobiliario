import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Ajustes {
  transcribirVoz: boolean;
  servidor: { openai: boolean; claude: boolean };
}

/** Si las notas de voz se transcriben y resumen, o se guardan solo como audio. */
export default function AjustesVoz() {
  const qc = useQueryClient();
  const ajustes = useQuery({ queryKey: ['ajustes'], queryFn: () => api.get<Ajustes>('/ajustes') });
  const cambiar = useMutation({
    mutationFn: (transcribirVoz: boolean) => api.patch('/ajustes', { transcribirVoz }),
    // El interruptor cambia al tocarlo; si el servidor falla, vuelve a su estado real.
    onMutate: (transcribirVoz) =>
      qc.setQueryData<Ajustes>(['ajustes'], (a) => (a ? { ...a, transcribirVoz } : a)),
    onError: () => qc.invalidateQueries({ queryKey: ['ajustes'] }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['ajustes'] });
      qc.invalidateQueries({ queryKey: ['notas-voz'] });
    },
  });

  const a = ajustes.data;
  const faltaOpenai = a && !a.servidor.openai;

  return (
    <div className="card">
      <strong>Notas de voz</strong>
      <p className="meta" style={{ marginTop: 6 }}>
        Los asesores graban en la ficha del lead cómo les fue con el cliente.
      </p>

      <label className="interruptor">
        <input
          type="checkbox"
          checked={a?.transcribirVoz ?? false}
          disabled={!a}
          onChange={(e) => cambiar.mutate(e.target.checked)}
        />
        <span>
          <strong>Transcribir y proponer la actividad</strong>
          <span className="meta" style={{ display: 'block', fontWeight: 400 }}>
            OpenAI pasa el audio a texto y Claude propone el resumen y el siguiente seguimiento,
            que el asesor revisa antes de registrar. Menos de un centavo de dólar por nota.
          </span>
        </span>
      </label>

      {a && !a.transcribirVoz && (
        <p className="meta" style={{ marginTop: 10 }}>
          <strong>Apagado:</strong> se guarda solo el audio, en este servidor. No hace falta ninguna
          cuenta externa, no cuesta nada y el audio no sale del país. Si lo prendes después, cada
          nota guardada se puede transcribir con un botón.
        </p>
      )}

      {a?.transcribirVoz && (faltaOpenai || !a.servidor.claude) && (
        <div className="card" style={{ background: 'var(--ambar-tinte)', borderColor: '#f3dfae', marginTop: 12, marginBottom: 0 }}>
          <strong>Falta configurar el servidor</strong>
          <p className="meta" style={{ marginTop: 4, marginBottom: 0 }}>
            {faltaOpenai && <>Sin <code className="codigo">OPENAI_API_KEY</code> las notas no se transcriben. </>}
            {!a.servidor.claude && <>Sin <code className="codigo">ANTHROPIC_API_KEY</code> queda la transcripción pero no la propuesta. </>}
            Se agregan en las variables del CRM en Plesk y luego se reinicia la aplicación.
          </p>
        </div>
      )}

      {a?.transcribirVoz && (
        <p className="meta" style={{ marginTop: 10 }}>
          <strong>Ley 29733:</strong> el audio y su texto se envían a OpenAI y Anthropic (EE. UU.).
          Debe figurar en la política de privacidad y en el contrato con el cliente.
        </p>
      )}
      {cambiar.isError && <p className="error">{(cambiar.error as Error).message}</p>}
    </div>
  );
}
