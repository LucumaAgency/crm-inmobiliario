/**
 * Ajustes → Respaldos.
 *
 * - El administrador de la organización ve cuándo fue el último respaldo automático y si
 *   llegó a Drive, y descarga una copia completa de su información (sin credenciales).
 * - Lucuma (`registro.ver`) puede forzar el respaldo automático ahora, para probar Drive
 *   sin esperar a la madrugada.
 *
 * La descarga es una exportación masiva de datos personales: queda en auditoría igual que
 * el CSV de leads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { audit, requireAuth, requirePermiso } from '../lib/auth.js';
import { driveConfigurado } from '../lib/drive.js';
import { env } from '../env.js';
import { dirAutomaticos, dirDescargas, generarDescarga, leerEstadoRespaldo, listarZips, respaldarOrganizacion, } from '../services/respaldos.js';
/** Una descarga a la vez por organización: armar el ZIP lee toda la base del cliente. */
const generando = new Set();
export default async function respaldosRoutes(app) {
    const puede = [requireAuth, requirePermiso('respaldos.descargar')];
    app.get('/', { preHandler: puede }, async (req) => {
        const org = req.user.organizationId;
        return {
            activos: env.respaldosActivos,
            drive: driveConfigurado(),
            automatico: await leerEstadoRespaldo(org),
            enServidor: listarZips(dirAutomaticos(org)).map(({ nombre, bytes, creadoEl }) => ({ nombre, bytes, creadoEl })),
            descargas: listarZips(dirDescargas(org)),
            generando: generando.has(org),
        };
    });
    app.post('/', { preHandler: puede }, async (req, reply) => {
        const org = req.user.organizationId;
        if (generando.has(org))
            return reply.code(409).send({ error: 'Ya se está generando un respaldo. Espera unos segundos.' });
        generando.add(org);
        try {
            const r = await generarDescarga(org);
            await audit(org, req.user.id, 'respaldo.generar', { meta: { archivo: r.nombre, bytes: r.bytes, conteos: r.conteos }, ip: req.ip });
            return { nombre: r.nombre, bytes: r.bytes };
        }
        finally {
            generando.delete(org);
        }
    });
    app.get('/descargar/:nombre', { preHandler: puede }, async (req, reply) => {
        const org = req.user.organizationId;
        // Solo un nombre de archivo de la carpeta de descargas de ESTA organización.
        if (!/^respaldo-[a-z0-9-]+\.zip$/.test(req.params.nombre))
            return reply.code(400).send({ error: 'Nombre inválido' });
        const ruta = path.join(dirDescargas(org), req.params.nombre);
        if (!fs.existsSync(ruta))
            return reply.code(404).send({ error: 'El respaldo ya no está. Genera uno nuevo.' });
        await audit(org, req.user.id, 'respaldo.descarga', { meta: { archivo: req.params.nombre }, ip: req.ip });
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Length', String(fs.statSync(ruta).size));
        reply.header('Content-Disposition', `attachment; filename="${req.params.nombre}"`);
        return reply.send(fs.createReadStream(ruta));
    });
    app.post('/automatico', { preHandler: [requireAuth, requirePermiso('registro.ver')] }, async (req) => {
        const org = req.user.organizationId;
        const estado = await respaldarOrganizacion(org);
        await audit(org, req.user.id, 'respaldo.automatico.forzado', { meta: { archivo: estado.archivo, error: estado.error } });
        return estado;
    });
}
