import { z } from 'zod';
import { esCuentaLucuma, etiquetas } from '@lucuma-crm/shared';
import { prisma } from '../db.js';
import { requireAuth, scopeForUser, tiene } from '../lib/auth.js';
/** Fecha en que se publicó la guía. */
const GUIA_DESDE = new Date('2026-10-25T00:00:00-05:00');
export default async function primerosPasosRoutes(app) {
    app.addHook('preHandler', requireAuth);
    app.get('/', async (req) => {
        const user = req.user;
        const orgId = user.organizationId;
        const puede = (p) => tiene(user, p);
        const [org, yo] = await Promise.all([
            prisma.organization.findUniqueOrThrow({ where: { id: orgId }, select: { vertical: true } }),
            prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phone: true, preferencias: true, createdAt: true } }),
        ]);
        const L = etiquetas(org.vertical);
        const agencia = org.vertical === 'agencia';
        const enProyecto = { project: { organizationId: orgId } };
        const [proyecto, proyectos, tipologias, unidades, conDatos, equipo, sitios, paginas, numeros, leads, seguimientos] = await Promise.all([
            prisma.project.findFirst({ where: { organizationId: orgId, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
            prisma.project.count({ where: { organizationId: orgId } }),
            prisma.typology.count({ where: enProyecto }),
            prisma.unit.count({ where: enProyecto }),
            prisma.project.count({ where: { organizationId: orgId, legalName: { not: null } } }),
            prisma.user.findMany({ where: { organizationId: orgId, active: true }, select: { email: true } }),
            prisma.site.count({ where: { organizationId: orgId } }),
            prisma.metaPage.count({ where: { organizationId: orgId } }),
            prisma.waNumber.count({ where: { organizationId: orgId } }),
            prisma.lead.count({ where: scopeForUser(user) }),
            prisma.activity.count({ where: { dueAt: { not: null }, lead: scopeForUser(user) } }),
        ]);
        const ficha = (pestana) => (proyecto ? `/proyectos/${proyecto.id}?pestana=${pestana}` : '/proyectos');
        const pasos = [];
        if (puede('inventario.editar')) {
            pasos.push({
                id: 'proyecto',
                titulo: agencia ? 'Crea tus servicios' : 'Crea tu primer proyecto',
                texto: agencia
                    ? `Cada servicio que vendes (por ejemplo «${L.ejemploProyecto}») es la base de tus propuestas y de los leads: cada lead se asocia a un servicio.`
                    : `Cada proyecto inmobiliario (por ejemplo «${L.ejemploProyecto}») agrupa sus tipologías, unidades y leads. Sin proyecto, los leads no entran a ningún embudo útil.`,
                enlace: '/proyectos',
                accion: agencia ? 'Ir a Servicios' : 'Ir a Proyectos',
                hecho: proyectos > 0,
            });
            if (!agencia) {
                pasos.push({
                    id: 'tipologias',
                    titulo: 'Añade las tipologías',
                    texto: 'Las tipologías son los tipos de departamento (flat de 2 dormitorios, dúplex…) con su área y precio desde. El asesor las marca como interés del lead y salen en la proforma.',
                    enlace: ficha('tipologias'),
                    accion: 'Ir a Tipologías',
                    hecho: tipologias > 0,
                });
            }
            pasos.push({
                id: 'unidades',
                titulo: agencia ? 'Arma tus paquetes' : 'Carga las unidades',
                texto: agencia
                    ? `Los paquetes (por ejemplo «${L.ejemploUnidad}») son las versiones de cada servicio con su precio. Con ellos armas una propuesta en PDF desde la ficha del lead.`
                    : 'Las unidades (601, 702, estacionamientos…) con su precio y estado. Puedes importarlas de una vez desde un CSV. Las proformas solo se emiten sobre unidades disponibles.',
                enlace: ficha(agencia ? 'paquetes' : 'unidades'),
                accion: agencia ? 'Ir a Paquetes' : 'Ir a Unidades',
                hecho: unidades > 0,
            });
            pasos.push({
                id: 'datos',
                titulo: `Completa los datos para ${L.documentos.toLowerCase()}`,
                texto: `Razón social, RUC y logo que salen en cada ${L.documento.toLowerCase()} en PDF. Están en la pestaña «Datos» de cada ${L.proyecto.toLowerCase()}.`,
                enlace: ficha('datos'),
                accion: 'Completar datos',
                hecho: conDatos > 0,
            });
        }
        if (puede('usuarios.gestionar')) {
            pasos.push({
                id: 'equipo',
                titulo: 'Invita a tu equipo',
                texto: 'Crea un usuario para cada asesor. Cada uno ve sus leads, recibe los avisos y trabaja desde el celular. Tú decides qué puede ver cada rol.',
                enlace: '/ajustes?seccion=usuarios',
                accion: 'Ir a Usuarios',
                hecho: equipo.filter((u) => !esCuentaLucuma(u.email)).length > 1,
                opcional: true,
            });
        }
        if (puede('canales.configurar')) {
            pasos.push({
                id: 'canales',
                titulo: 'Conecta por dónde llegan tus leads',
                texto: 'WhatsApp, Meta Lead Ads o el formulario de tu web: así los leads entran solos al CRM, con su origen, y nadie tiene que copiarlos a mano.',
                enlace: '/ajustes?seccion=whatsapp',
                accion: 'Ir a Canales',
                hecho: sitios + paginas + numeros > 0,
                opcional: true,
            });
        }
        if (puede('leads.editar')) {
            pasos.push({
                id: 'telefono',
                titulo: 'Pon tu teléfono en Mi cuenta',
                texto: `Sale en cada ${L.documento.toLowerCase()} para que el cliente sepa a quién llamar.`,
                enlace: '/cuenta',
                accion: 'Ir a Mi cuenta',
                hecho: !!yo.phone,
            });
            pasos.push({
                id: 'lead',
                titulo: 'Registra tu primer lead',
                texto: 'Con el botón «Nuevo lead» cargas a alguien que te escribió o llamó. Si conectaste un canal, los leads aparecen solos en la lista.',
                enlace: '/leads',
                accion: 'Ir a Leads',
                hecho: leads > 0,
            });
            pasos.push({
                id: 'seguimiento',
                titulo: 'Agenda un seguimiento',
                texto: `En la ficha del lead registra lo que hablaste y agenda el siguiente paso (llamada, WhatsApp, ${L.visita.toLowerCase()}). Tus pendientes del día salen en Seguimientos.`,
                enlace: '/seguimientos',
                accion: 'Ir a Seguimientos',
                hecho: seguimientos > 0,
            });
        }
        const prefs = (yo.preferencias ?? {});
        const completados = pasos.filter((p) => p.hecho).length;
        return {
            vertical: org.vertical,
            pasos,
            completados,
            total: pasos.length,
            // El asistente se abre solo la primera vez; la tarjeta de Resumen queda hasta
            // completar todo o hasta que la persona la oculte.
            // Solo a quien llegó después de que existiera la guía: a un asesor que ya trabaja no
            // se le abre una bienvenida (igual la ve en el menú y en la tarjeta de Resumen).
            abrirAsistente: !prefs.primerosPasosVisto && completados < pasos.length && yo.createdAt >= GUIA_DESDE,
            oculto: !!prefs.primerosPasosOculto,
        };
    });
    app.post('/', async (req, reply) => {
        const parsed = z.object({ accion: z.enum(['visto', 'ocultar', 'mostrar']) }).safeParse(req.body);
        if (!parsed.success)
            return reply.code(400).send({ error: 'Datos inválidos' });
        const yo = await prisma.user.findUniqueOrThrow({ where: { id: req.user.id }, select: { preferencias: true } });
        const prefs = { ...(yo.preferencias ?? {}) };
        const ahora = new Date().toISOString();
        if (parsed.data.accion === 'visto')
            prefs.primerosPasosVisto = ahora;
        if (parsed.data.accion === 'ocultar') {
            prefs.primerosPasosOculto = ahora;
            prefs.primerosPasosVisto ??= ahora;
        }
        if (parsed.data.accion === 'mostrar')
            delete prefs.primerosPasosOculto;
        await prisma.user.update({ where: { id: req.user.id }, data: { preferencias: prefs } });
        return { ok: true };
    });
}
