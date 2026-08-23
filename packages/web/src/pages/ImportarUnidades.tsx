import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api.js';

interface Props {
  projectId: string;
  onCerrar: () => void;
  onImportado: () => void;
}

interface Resultado {
  creadas: number;
  actualizadas: number;
  tipologiasCreadas: string[];
  errores: { linea: number; codigo: string; motivo: string }[];
}

const COLUMNAS = ['codigo', 'tipologia', 'piso', 'dormitorios', 'area_m2', 'precio', 'moneda', 'tipo', 'estado'];

const EJEMPLO = `codigo,tipologia,piso,dormitorios,area_m2,precio,moneda,tipo,estado
301,Tipo A · 1 dorm,3,1,42.5,295000,PEN,departamento,disponible
302,Tipo B · 2 dorm,3,2,68.2,410000,PEN,departamento,disponible
401,Tipo B · 2 dorm,4,2,68.2,425000,PEN,departamento,vendido`;

/**
 * Lector de CSV.
 *
 * Escrito a mano en vez de traer una librería: el formato que sale de un Excel es una coma,
 * un salto de línea y comillas alrededor de los campos que contienen comas. Contempla las
 * comillas dobles escapadas y el separador punto y coma, que es lo que exporta Excel en
 * español y es la primera piedra con la que tropieza cualquiera.
 */
function leerCsv(texto: string): { cabeceras: string[]; filas: Record<string, string>[] } {
  const limpio = texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  if (!limpio) return { cabeceras: [], filas: [] };

  const primera = limpio.slice(0, limpio.indexOf('\n') === -1 ? undefined : limpio.indexOf('\n'));
  const sep = primera.split(';').length > primera.split(',').length ? ';' : ',';

  const celdas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let entreComillas = false;

  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') entreComillas = false;
      else campo += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); celdas.push(fila); fila = []; campo = ''; }
    else campo += c;
  }
  fila.push(campo);
  celdas.push(fila);

  const cabeceras = (celdas.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const filas = celdas
    .filter((f) => f.some((v) => v.trim() !== ''))
    .map((f) => {
      const o: Record<string, string> = {};
      cabeceras.forEach((h, i) => { o[h] = (f[i] ?? '').trim(); });
      return o;
    });

  return { cabeceras, filas };
}

export default function ImportarUnidades({ projectId, onCerrar, onImportado }: Props) {
  const [texto, setTexto] = useState('');
  const [crearTipologias, setCrearTipologias] = useState(true);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const { cabeceras, filas } = leerCsv(texto);
  const faltaCodigo = texto.trim() !== '' && !cabeceras.includes('codigo');
  const desconocidas = cabeceras.filter((h) => h && !COLUMNAS.includes(h));

  const importar = useMutation({
    mutationFn: () =>
      api.post<Resultado>(`/projects/${projectId}/units/import`, { crearTipologias, filas }),
    onSuccess: (r) => { setResultado(r); onImportado(); },
  });

  const cargarArchivo = (f: File | undefined) => {
    if (!f) return;
    const lector = new FileReader();
    lector.onload = () => setTexto(String(lector.result ?? ''));
    lector.readAsText(f);
  };

  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cab">
          <h2>Importar unidades</h2>
          <button type="button" className="cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>

        {!resultado && (
          <>
            <p className="meta">
              Columnas: <code className="codigo">{COLUMNAS.join(', ')}</code>. Solo <strong>codigo</strong> es
              obligatorio. Si una unidad ya existe con ese código, se actualiza en vez de duplicarse,
              así que puedes reimportar el archivo para cambiar precios o estados.
            </p>

            <label htmlFor="csv-file">Archivo CSV</label>
            <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(e) => cargarArchivo(e.target.files?.[0])} />

            <label htmlFor="csv-texto">O pega el contenido</label>
            <textarea
              id="csv-texto"
              rows={7}
              value={texto}
              placeholder={EJEMPLO}
              onChange={(e) => setTexto(e.target.value)}
              style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
            />

            <label className="lcrm-check" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={crearTipologias}
                style={{ width: 'auto' }}
                onChange={(e) => setCrearTipologias(e.target.checked)}
              />
              Crear las tipologías que no existan
            </label>

            {faltaCodigo && <p className="error">Falta la columna «codigo», que es la que identifica cada unidad.</p>}
            {desconocidas.length > 0 && (
              <p className="meta">Columnas que se ignoran: {desconocidas.join(', ')}</p>
            )}

            {filas.length > 0 && !faltaCodigo && (
              <>
                <p className="meta" style={{ marginTop: 10 }}>
                  <strong>{filas.length}</strong> fila(s) detectada(s). Primeras:
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table className="tabla">
                    <thead><tr>{cabeceras.filter((h) => COLUMNAS.includes(h)).map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>
                      {filas.slice(0, 3).map((f, i) => (
                        <tr key={i}>
                          {cabeceras.filter((h) => COLUMNAS.includes(h)).map((h) => <td key={h}>{f[h]}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {importar.isError && <p className="error">{(importar.error as Error).message}</p>}

            <div className="acciones" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn"
                disabled={filas.length === 0 || faltaCodigo || importar.isPending}
                onClick={() => importar.mutate()}
              >
                {importar.isPending ? 'Importando…' : `Importar ${filas.length || ''} unidad(es)`}
              </button>
              <button type="button" className="btn btn-sec" onClick={onCerrar}>Cancelar</button>
            </div>
          </>
        )}

        {resultado && (
          <>
            <div className="stats" style={{ marginTop: 12 }}>
              <div className="stat"><div className="n">{resultado.creadas}</div><div className="t">Creadas</div></div>
              <div className="stat"><div className="n">{resultado.actualizadas}</div><div className="t">Actualizadas</div></div>
              <div className="stat"><div className="n">{resultado.tipologiasCreadas.length}</div><div className="t">Tipologías nuevas</div></div>
              <div className="stat"><div className="n">{resultado.errores.length}</div><div className="t">Con error</div></div>
            </div>

            {resultado.tipologiasCreadas.length > 0 && (
              <p className="meta">Tipologías creadas: {resultado.tipologiasCreadas.join(', ')}. Complétalas con área, precio y plano.</p>
            )}

            {resultado.errores.length > 0 && (
              <>
                <p className="error" style={{ marginTop: 10 }}>
                  Estas filas no se importaron. El resto sí.
                </p>
                <div style={{ overflowX: 'auto', maxHeight: 220 }}>
                  <table className="tabla">
                    <thead><tr><th>Línea</th><th>Código</th><th>Motivo</th></tr></thead>
                    <tbody>
                      {resultado.errores.map((e, i) => (
                        <tr key={i}><td>{e.linea}</td><td>{e.codigo || '—'}</td><td>{e.motivo}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="acciones" style={{ marginTop: 16 }}>
              <button type="button" className="btn" onClick={onCerrar}>Cerrar</button>
              <button type="button" className="btn btn-sec" onClick={() => { setResultado(null); setTexto(''); }}>
                Importar otro archivo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
