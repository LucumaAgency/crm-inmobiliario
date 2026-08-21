/**
 * Semilla de desarrollo: organización Bastión con el proyecto Domus real.
 * Datos tomados de bastion/crm-sperant/UNIDADES.md (estado a 2026-07-03).
 *
 *   npm run seed -w @lucuma-crm/api
 */
import { prisma } from './db.js';
import { generatePublicKey, generateSecretKey, hashKey } from './lib/keys.js';
import type { FormSchema } from '@lucuma-crm/shared';

const ETAPAS = [
  { slug: 'por-contactar', name: 'Por contactar', position: 1, color: '#94a3b8' },
  { slug: 'contactado', name: 'Contactado', position: 2, color: '#3b82f6' },
  { slug: 'visita-agendada', name: 'Visita agendada', position: 3, color: '#8b5cf6' },
  { slug: 'cotizado', name: 'Cotizado', position: 4, color: '#f59e0b' },
  { slug: 'separacion', name: 'Separación', position: 5, color: '#10b981' },
  { slug: 'vendido', name: 'Vendido', position: 6, color: '#059669', isWon: true },
  { slug: 'perdido', name: 'Perdido', position: 7, color: '#ef4444', isLost: true },
];

// unit_id original de Sperant | depto | tipología | dorm | área | precio | estado
const UNIDADES_DOMUS = [
  ['201', '201', 2, 53.71, 367000, 'disponible'],
  ['301', '201', 2, 53.56, 367000, 'no_disponible'],
  ['401', '201', 2, 53.56, 367000, 'no_disponible'],
  ['501', '201', 2, 53.56, 367000, 'no_disponible'],
  ['202', '202', 3, 101.57, 546000, 'no_disponible'],
  ['302', '302', 3, 71.62, 484000, 'disponible'],
  ['402', '302', 3, 71.62, 484000, 'disponible'],
  ['502', '302', 3, 71.62, 484000, 'no_disponible'],
  ['601', '603', 1, 41.55, 299000, 'no_disponible'],
  ['602', '602', 1, 41.75, 310000, 'disponible'],
  ['603', '603', 1, 41.55, 299000, 'disponible'],
  ['701', '601', 1, 40.05, 299000, 'disponible'],
  ['702', '602', 1, 41.75, 310000, 'disponible'],
  ['703', '603', 1, 41.55, 299000, 'disponible'],
  ['801', '801', 3, 96.17, 543000, 'disponible'],
  ['802', '802', 3, 101.93, 635000, 'no_disponible'],
] as const;

const FORMULARIO_DOMUS: FormSchema = {
  name: 'Contacto Domus',
  submitLabel: 'Quiero más información',
  fields: [
    { key: 'fname', semantic: 'fname', type: 'text', label: 'Nombre', required: true },
    { key: 'lname', semantic: 'lname', type: 'text', label: 'Apellido', required: true },
    { key: 'phone', semantic: 'phone', type: 'tel', label: 'Teléfono', required: true },
    { key: 'email', semantic: 'email', type: 'email', label: 'Correo', required: true },
    { key: 'document', semantic: 'document', type: 'text', label: 'DNI', required: false },
    {
      key: 'unidad',
      semantic: 'unit_interest',
      type: 'select',
      label: 'Tipología de interés',
      required: false,
      source: {
        type: 'units',
        onlyAvailable: true,
        excludeKinds: ['estacionamiento', 'deposito'],
      },
    },
    { key: 'mensaje', semantic: 'message', type: 'textarea', label: 'Mensaje', required: false },
  ],
  consent: {
    required: true,
    version: '2026-08',
    text: 'Autorizo el tratamiento de mis datos personales conforme a la Política de Privacidad.',
  },
  antispam: { honeypot: true, minSeconds: 3, turnstile: false },
  success: { type: 'message', value: 'Gracias. Un asesor te contactará hoy mismo.' },
};

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'bastion' },
    update: {},
    create: { name: 'Bastión', slug: 'bastion' },
  });

  for (const e of ETAPAS) {
    await prisma.stage.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: e.slug } },
      update: { name: e.name, position: e.position, color: e.color },
      create: { ...e, organizationId: org.id },
    });
  }

  const admin = await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'admin@lucuma.agency' } },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@lucuma.agency',
      name: 'Admin Lucuma',
      role: 'admin_lucuma',
    },
  });
  await prisma.user.upsert({
    where: { organizationId_email: { organizationId: org.id, email: 'asesor@bastion.pe' } },
    update: {},
    create: { organizationId: org.id, email: 'asesor@bastion.pe', name: 'Asesor Demo', role: 'asesor' },
  });

  const domus = await prisma.project.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: 'domus' } },
    update: {},
    create: { organizationId: org.id, name: 'Domus', slug: 'domus', code: 'ED' },
  });

  for (const [code, typology, bedrooms, areaM2, price, status] of UNIDADES_DOMUS) {
    await prisma.unit.upsert({
      where: { projectId_code: { projectId: domus.id, code } },
      update: { status: status as never },
      create: {
        projectId: domus.id,
        code,
        typology,
        bedrooms,
        areaM2,
        price,
        currency: 'PEN',
        kind: 'departamento',
        status: status as never,
      },
    });
  }

  let site = await prisma.site.findFirst({ where: { organizationId: org.id } });
  let secretKey: string | null = null;
  if (!site) {
    secretKey = generateSecretKey();
    site = await prisma.site.create({
      data: {
        organizationId: org.id,
        name: 'proyectodomus.pe',
        publicKey: generatePublicKey(),
        secretKeyHash: hashKey(secretKey),
        allowedOrigins: ['proyectodomus.pe', 'www.proyectodomus.pe', 'localhost:5173'] as never,
      },
    });
  }

  const existente = await prisma.form.findFirst({ where: { organizationId: org.id } });
  const form =
    existente ??
    (await prisma.form.create({
      data: {
        organizationId: org.id,
        siteId: site.id,
        projectId: domus.id,
        name: 'Contacto Domus',
        schema: FORMULARIO_DOMUS as never,
        notifyEmails: ['ventas@bastion.pe'] as never,
      },
    }));

  console.log('\n  Semilla lista.\n');
  console.log('  Organización : Bastión');
  console.log('  Admin        : admin@lucuma.agency  (entra con magic link)');
  console.log('  Proyecto     : Domus con', UNIDADES_DOMUS.length, 'unidades');
  console.log('  Sitio        : proyectodomus.pe');
  console.log('  Public key   :', site.publicKey);
  if (secretKey) console.log('  Secret key   :', secretKey, ' <- se muestra una sola vez');
  console.log('  Form ID      :', form.id, '\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
