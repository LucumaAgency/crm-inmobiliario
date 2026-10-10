/**
 * Importa el catálogo de servicios de Lucuma (propuestas/paquetes/servicios.json) a una
 * organización de vertical agencia: cada servicio es un Project y cada paquete una Unit.
 *
 *   npm run catalogo:prod -- <slug> [ruta-al-json]
 *
 * Es idempotente: reimportar actualiza nombres, precios y descripciones sin duplicar. El
 * precio «desde S/ 3.000» se guarda como 3000 y se marca `extra.desde = true`; los que no
 * tienen cifra («a medida») quedan sin precio y no se pueden cotizar hasta ponerles uno.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from './db.js';
const [slug, rutaDada] = process.argv.slice(2);
if (!slug) {
    console.error('Uso: npm run catalogo:prod -- <slug> [ruta-al-json]');
    process.exit(1);
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ruta = rutaDada ?? path.resolve(__dirname, '../data/catalogo-lucuma.json');
const servicios = JSON.parse(fs.readFileSync(ruta, 'utf8'));
const org = await prisma.organization.findUnique({ where: { slug } });
if (!org) {
    console.error(`No existe la organización ${slug}.`);
    process.exit(1);
}
if (org.vertical !== 'agencia')
    console.warn(`OJO: ${slug} es vertical «${org.vertical}»; el catálogo es de agencia.`);
function precioDe(texto) {
    const desde = /desde/i.test(texto);
    const m = texto.replace(/\./g, '').replace(',', '.').match(/(\d+(?:\.\d+)?)/);
    return { precio: m ? Number(m[1]) : null, desde };
}
let proyectos = 0, paquetes = 0;
for (const s of servicios) {
    const project = await prisma.project.upsert({
        where: { organizationId_slug: { organizationId: org.id, slug: s.id } },
        update: { name: s.nombre, code: s.modalidad ?? null },
        create: { organizationId: org.id, slug: s.id, name: s.nombre, code: s.modalidad ?? null },
    });
    proyectos++;
    for (const [i, p] of s.packs.entries()) {
        const { precio, desde } = precioDe(p.precio);
        const extra = {
            orden: i + 1,
            etiqueta: p.n,
            cobro: p.unidad ?? null,
            desde,
            precioTexto: p.precio,
            destacado: p.destacado ?? false,
            paraQuien: p.para_quien ?? null,
            bloques: p.bloques ?? [],
            modalidad: s.modalidad ?? null,
            lede: s.lede ?? null,
            nota: s.nota ?? null,
        };
        await prisma.unit.upsert({
            where: { projectId_code: { projectId: project.id, code: p.nombre } },
            update: { price: precio, currency: 'PEN', kind: 'otro', status: 'disponible', extra: extra },
            create: { projectId: project.id, code: p.nombre, price: precio, currency: 'PEN', kind: 'otro', status: 'disponible', extra: extra },
        });
        paquetes++;
    }
}
console.log(`${proyectos} servicios y ${paquetes} paquetes importados en ${org.name}.`);
await prisma.$disconnect();
