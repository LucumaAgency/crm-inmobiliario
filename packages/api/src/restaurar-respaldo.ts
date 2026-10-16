/**
 * Restaura el respaldo de una organización (services/respaldos.ts).
 *
 *     npm run restaurar -- <respaldo.zip>              # revisa y cuenta, no escribe nada
 *     npm run restaurar -- <respaldo.zip> --confirmar  # restaura
 *     (en producción: npm run restaurar:prod -- ...)
 *
 * Solo restaura en una base donde esa organización NO existe: tras perder el servidor, en
 * una base nueva, o después de borrar la organización dañada. Nunca mezcla un respaldo con
 * datos vivos, porque no hay forma segura de decidir qué fila gana.
 *
 * Inserta las tablas en orden de dependencias con los mismos ids, y copia los archivos a
 * `uploads/` y `privados/` sin pisar los que ya existan. Si algo falla a mitad, borra la
 * organización a medio crear (en cascada), para dejar la base como estaba.
 *
 * Un respaldo «cliente» también se puede restaurar, pero viene sin contraseñas ni tokens:
 * los usuarios entran por enlace al correo y hay que reconectar Meta y WhatsApp.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import { uploadsDir } from './lib/media.js';
import { privadosDir } from './lib/privados.js';
import { leerZip } from './lib/zip.js';
import { FORMATO, TABLAS, delegado } from './services/respaldos.js';

type Fila = Record<string, unknown>;

/** Los Json nulos tienen que ir como `Prisma.DbNull`: con `null` a secas, createMany falla. */
function preparar(modelo: Prisma.ModelName, filas: Fila[]): Fila[] {
  const m = Prisma.dmmf.datamodel.models.find((x) => x.name === modelo)!;
  const json = m.fields.filter((f) => f.type === 'Json').map((f) => f.name);
  if (json.length === 0) return filas;
  return filas.map((f) => {
    const c = { ...f };
    for (const k of json) if (c[k] === null || c[k] === undefined) c[k] = Prisma.DbNull;
    return c;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const zipRuta = args.find((a) => !a.startsWith('--'));
  const confirmar = args.includes('--confirmar');
  if (!zipRuta) throw new Error('Uso: restaurar-respaldo <respaldo.zip> [--confirmar]');

  const zip = leerZip(path.resolve(zipRuta));
  const manifiesto = JSON.parse(zip.get('respaldo.json')?.toString('utf8') ?? 'null') as {
    formato: number;
    variante: string;
    generadoEl: string;
    organizacion: { id: string; slug: string; name: string };
    conteos: Record<string, number>;
  } | null;
  if (!manifiesto) throw new Error('El ZIP no tiene respaldo.json: no es un respaldo del CRM');
  if (manifiesto.formato !== FORMATO) throw new Error(`Formato ${manifiesto.formato}; este restaurador entiende el ${FORMATO}`);
  const org = manifiesto.organizacion;

  console.log(`Respaldo de ${org.name} (${org.slug}), ${manifiesto.variante}, generado el ${manifiesto.generadoEl}`);

  const tablas: Record<string, Fila[]> = {};
  for (const t of TABLAS) {
    const b = zip.get(`datos/${t.modelo}.json`);
    if (!b) throw new Error(`Falta datos/${t.modelo}.json`);
    tablas[t.modelo] = JSON.parse(b.toString('utf8')) as Fila[];
    const esperado = manifiesto.conteos[t.modelo];
    if (esperado !== undefined && esperado !== tablas[t.modelo]!.length) {
      throw new Error(`${t.modelo}: el manifiesto dice ${esperado} filas y hay ${tablas[t.modelo]!.length}`);
    }
    console.log(`  ${t.modelo.padEnd(22)} ${tablas[t.modelo]!.length}`);
  }
  const archivos = [...zip.keys()].filter((k) => k.startsWith('archivos/') && !k.endsWith('/'));
  console.log(`  archivos               ${archivos.length}`);

  const existe = await prisma.organization.findUnique({ where: { id: org.id }, select: { id: true } });
  const choqueSlug = await prisma.organization.findUnique({ where: { slug: org.slug }, select: { id: true } });
  if (existe || choqueSlug) {
    throw new Error(
      `La organización ${org.slug} ya existe en esta base. Solo se restaura donde no existe ` +
        `(base nueva, o tras borrar la organización dañada).`
    );
  }
  if (!confirmar) {
    console.log('\nRevisión correcta. Nada se escribió. Para restaurar, repite con --confirmar.');
    return;
  }

  try {
    for (const t of TABLAS) {
      const filas = preparar(t.modelo, tablas[t.modelo]!);
      for (let i = 0; i < filas.length; i += 500) {
        await delegado(t.modelo).createMany({ data: filas.slice(i, i + 500) });
      }
    }
  } catch (err) {
    console.error('\nFalló la restauración; se deshace lo insertado.');
    // AuditLog no cuelga de la organización con una relación: se borra aparte.
    await prisma.auditLog.deleteMany({ where: { organizationId: org.id } });
    await prisma.organization.deleteMany({ where: { id: org.id } });
    throw err;
  }

  let copiados = 0;
  let saltados = 0;
  for (const k of archivos) {
    const [, carpeta, ...resto] = k.split('/');
    const base = carpeta === 'uploads' ? uploadsDir : carpeta === 'privados' ? privadosDir : null;
    if (!base) continue;
    const destino = path.resolve(base, ...resto);
    if (!destino.startsWith(base + path.sep)) throw new Error(`Ruta inválida en el respaldo: ${k}`);
    if (fs.existsSync(destino)) {
      saltados++;
      continue;
    }
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, zip.get(k)!);
    copiados++;
  }

  console.log(`\nRestaurada ${org.slug}: ${archivos.length} archivos (${copiados} copiados, ${saltados} ya estaban).`);
  if (manifiesto.variante === 'cliente') {
    console.log('Respaldo sin credenciales: los usuarios entran por enlace al correo y hay que reconectar Meta y WhatsApp.');
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
