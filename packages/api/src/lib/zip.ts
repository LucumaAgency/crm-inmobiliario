/**
 * ZIP mínimo, sin dependencias: lo justo para los respaldos.
 *
 * Por qué no una librería: los respaldos son lo único que arma ZIP y basta con escribir
 * entradas completas (los archivos más grandes rondan los 16 MB) y leerlas de vuelta al
 * restaurar. Lo que esto NO soporta: ZIP64 (más de 4 GB o 65.535 entradas), cifrado ni
 * archivos de otros programas que usen extensiones raras. Si un respaldo se acerca a esos
 * límites, `cerrar()` falla en vez de escribir un archivo corrupto.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

/** Comprime en el pool de hilos de libuv: un ZIP grande no congela el servidor. */
const deflateRaw = promisify(zlib.deflateRaw);

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  // Node 20.15+ trae CRC32 nativo, decenas de veces más rápido que el bucle en JS.
  const nativo = (zlib as unknown as { crc32?: (b: Buffer) => number }).crc32;
  if (nativo) return nativo(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato de MS-DOS que usa ZIP (hora local del servidor). */
function fechaDos(d: Date) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const fecha = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, fecha };
}

/** Formatos que ya vienen comprimidos: comprimirlos otra vez solo gasta CPU. */
const YA_COMPRIMIDO = /\.(jpe?g|png|webp|gif|pdf|mp4|webm|m4a|ogg|opus|mp3|zip|docx|xlsx|pptx|gz)$/i;

interface Central {
  nombre: Buffer;
  crc: number;
  comprimido: number;
  original: number;
  metodo: number;
  hora: number;
  fecha: number;
  offset: number;
}

export class EscritorZip {
  private fd: number;
  private offset = 0;
  private entradas: Central[] = [];

  constructor(public readonly ruta: string) {
    this.fd = fs.openSync(ruta, 'w');
  }

  private escribir(b: Buffer) {
    fs.writeSync(this.fd, b);
    this.offset += b.length;
  }

  async agregar(nombre: string, contenido: Buffer | string, fecha = new Date()) {
    const datos = typeof contenido === 'string' ? Buffer.from(contenido, 'utf8') : contenido;
    const nombreBuf = Buffer.from(nombre.replace(/\\/g, '/'), 'utf8');
    const comprimir = !YA_COMPRIMIDO.test(nombre) && datos.length > 64;
    const cuerpo = comprimir ? await deflateRaw(datos, { level: 6 }) : datos;
    const metodo = comprimir ? 8 : 0;
    const crc = crc32(datos);
    const { hora, fecha: dia } = fechaDos(fecha);
    if (this.offset + cuerpo.length > 0xfffffff0) throw new Error('El respaldo supera 4 GB: hace falta ZIP64');

    const cab = Buffer.alloc(30);
    cab.writeUInt32LE(0x04034b50, 0);
    cab.writeUInt16LE(20, 4); // versión necesaria
    cab.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    cab.writeUInt16LE(metodo, 8);
    cab.writeUInt16LE(hora, 10);
    cab.writeUInt16LE(dia, 12);
    cab.writeUInt32LE(crc, 14);
    cab.writeUInt32LE(cuerpo.length, 18);
    cab.writeUInt32LE(datos.length, 22);
    cab.writeUInt16LE(nombreBuf.length, 26);
    cab.writeUInt16LE(0, 28);

    this.entradas.push({ nombre: nombreBuf, crc, comprimido: cuerpo.length, original: datos.length, metodo, hora, fecha: dia, offset: this.offset });
    this.escribir(cab);
    this.escribir(nombreBuf);
    this.escribir(cuerpo);
  }

  cerrar() {
    if (this.entradas.length > 0xffff) throw new Error('El respaldo tiene más de 65.535 archivos: hace falta ZIP64');
    const inicio = this.offset;
    for (const e of this.entradas) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4); // versión que lo creó
      c.writeUInt16LE(20, 6); // versión necesaria
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.metodo, 10);
      c.writeUInt16LE(e.hora, 12);
      c.writeUInt16LE(e.fecha, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.comprimido, 20);
      c.writeUInt32LE(e.original, 24);
      c.writeUInt16LE(e.nombre.length, 28);
      // extra, comentario, disco, atributos internos: 0
      c.writeUInt32LE(0, 38); // atributos externos
      c.writeUInt32LE(e.offset, 42);
      this.escribir(c);
      this.escribir(e.nombre);
    }
    const fin = Buffer.alloc(22);
    fin.writeUInt32LE(0x06054b50, 0);
    fin.writeUInt16LE(this.entradas.length, 8);
    fin.writeUInt16LE(this.entradas.length, 10);
    fin.writeUInt32LE(this.offset - inicio, 12);
    fin.writeUInt32LE(inicio, 16);
    this.escribir(fin);
    fs.closeSync(this.fd);
  }

  /** Si algo falla a medio camino: cerrar y borrar, para no dejar un ZIP a medias. */
  descartar() {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* ya cerrado */
    }
    fs.rmSync(this.ruta, { force: true });
  }
}

/** Lee un ZIP completo a memoria: nombre → contenido. Comprueba el CRC de cada entrada. */
export function leerZip(ruta: string): Map<string, Buffer> {
  const buf = fs.readFileSync(ruta);
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('No es un ZIP válido (falta el directorio central)');
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const salida = new Map<string, Buffer>();
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio central dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const largoExtra = buf.readUInt16LE(p + 30);
    const largoComentario = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString('utf8');
    p += 46 + largoNombre + largoExtra + largoComentario;

    const inicioDatos = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const crudo = buf.subarray(inicioDatos, inicioDatos + comprimido);
    const datos = metodo === 8 ? zlib.inflateRawSync(crudo) : metodo === 0 ? Buffer.from(crudo) : null;
    if (!datos) throw new Error(`Método de compresión no soportado en ${nombre}`);
    if (crc32(datos) !== crc) throw new Error(`El archivo ${nombre} está dañado (CRC)`);
    salida.set(nombre, datos);
  }
  return salida;
}
