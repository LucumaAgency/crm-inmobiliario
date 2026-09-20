/**
 * Visor del log de la aplicación, desde el propio CRM.
 *
 * El archivo vive en `logs/app.txt`, fuera del document root para que nginx no lo
 * publique nunca. Eso es correcto, pero deja el log accesible solo por el Administrador
 * de archivos de Plesk, que es incómodo y de hecho hizo que un webhook que fallaba
 * pareciera un webhook que no llegaba. Un log que nadie puede leer no cumple su función.
 *
 * Solo `admin_lucuma`: el log contiene enlaces de acceso cuando el SMTP no está
 * configurado, y esos enlaces ABREN SESIÓN. Un gerente no tiene por qué poder leer el
 * enlace de acceso de otra persona, así que además se redactan antes de salir.
 */
import fs from 'node:fs';
import { requireRole } from '../lib/auth.js';
import { logFile } from '../lib/log.js';
/** Cuánto se lee del final del archivo. Un log viejo puede pesar mucho. */
const MAX_BYTES = 256 * 1024;
export default async function logRoutes(app) {
    app.get('/', { preHandler: requireRole('admin_lucuma') }, async (req) => {
        const pedidas = Math.min(Math.max(Number(req.query.lines ?? 300) || 300, 10), 2000);
        let contenido = '';
        let existe = false;
        try {
            const stat = await fs.promises.stat(logFile);
            existe = true;
            // Solo la cola del archivo: leerlo entero con 200 MB tumbaría el proceso.
            const desde = Math.max(0, stat.size - MAX_BYTES);
            const fd = await fs.promises.open(logFile, 'r');
            try {
                const buffer = Buffer.alloc(Math.min(MAX_BYTES, stat.size));
                await fd.read(buffer, 0, buffer.length, desde);
                contenido = buffer.toString('utf8');
            }
            finally {
                await fd.close();
            }
            // El primer trozo puede quedar cortado a mitad de línea.
            if (desde > 0)
                contenido = contenido.slice(contenido.indexOf('\n') + 1);
        }
        catch {
            /* sin archivo todavía: la aplicación aún no escribió nada */
        }
        let lineas = contenido.split('\n').filter((l) => l.trim() !== '');
        const filtro = req.query.q?.trim().toLowerCase();
        if (filtro)
            lineas = lineas.filter((l) => l.toLowerCase().includes(filtro));
        return {
            archivo: logFile,
            existe,
            lineas: lineas.slice(-pedidas).map(redactar),
        };
    });
}
/**
 * Quita de la salida lo que abre sesión.
 *
 * Sin SMTP, los enlaces de acceso se escriben en el log para poder entrar igual. Es útil
 * y es exactamente lo que no debe viajar por una API: quien lo leyera entraría como esa
 * persona. Se redacta el token y se deja ver que hubo un enlace, que es la información
 * que sirve para diagnosticar.
 */
function redactar(linea) {
    return linea
        .replace(/(\/acceso\/|token=|magic=)[A-Za-z0-9._-]{8,}/g, '$1<oculto>')
        .replace(/(Bearer\s+)[A-Za-z0-9._-]{20,}/gi, '$1<oculto>');
}
