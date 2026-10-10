/**
 * Proformas: el documento que formaliza el precio ante el cliente y el banco.
 *
 * Replica el formato que Bastión usaba en Sperant (cabecera del proyecto, datos del cliente,
 * tabla de unidades, precio total y final, datos de la inmobiliaria, número y fecha, nota de
 * validez) y corrige lo rígido: el descuento lo aplica el asesor dentro de su tope, varias
 * unidades en una (departamento + estacionamiento + depósito), y la plantilla de datos la
 * controla el cliente (razón social, RUC y logo por proyecto; nota y validez por organización).
 *
 * El PDF se genera con pdfkit, puro JavaScript: en el Plesk compartido un navegador sin
 * cabeza es demasiado pesado y frágil. Para este diseño alcanza y sobra.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { prisma } from '../db.js';
import { leerAjustes } from '../lib/ajustes.js';
import { privadosDir, rutaPrivada } from '../lib/privados.js';
import { uploadsDir } from '../lib/media.js';

export interface ItemProforma {
  unitId: string;
  kind: string;
  code: string;
  typology: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  price: number;
}

export interface EmitirProformaInput {
  organizationId: string;
  leadId: string;
  userId: string;
  unitIds: string[];
  /** Uno de los dos; si vienen ambos manda el porcentaje. */
  discountPct?: number;
  discountAmount?: number;
  note?: string;
  validDays?: number;
  /** Fecha de vencimiento elegida por el asesor (YYYY-MM-DD); manda sobre validDays. */
  validUntil?: string;
  /** Nombre y teléfono del asesor tal como deben salir; por defecto los del usuario. */
  agentName?: string;
  agentPhone?: string;
}

const KIND_ES: Record<string, string> = {
  departamento: 'Departamento',
  estacionamiento: 'Estacionamiento',
  deposito: 'Depósito',
  lote: 'Lote',
  oficina: 'Oficina',
  otro: 'Otro',
};

export class ErrorProforma extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/** Tope efectivo del usuario: el propio, si no el de la organización, si no sin tope. */
export async function topeDescuento(userId: string, organizationId: string): Promise<number | null> {
  const [u, a] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { maxDiscountPct: true } }),
    leerAjustes(organizationId),
  ]);
  if (u?.maxDiscountPct != null) return Number(u.maxDiscountPct);
  return a.descuentoMaximoPct;
}

function redondear(n: number) {
  return Math.round(n * 100) / 100;
}

export async function emitirProforma(input: EmitirProformaInput) {
  const lead = await prisma.lead.findFirst({
    where: { id: input.leadId, organizationId: input.organizationId },
    include: { contact: true, project: true, owner: true },
  });
  if (!lead) throw new ErrorProforma('Lead no encontrado', 404);
  if (!lead.projectId || !lead.project) throw new ErrorProforma('El lead no tiene proyecto: asígnale uno en Interés');

  const ids = [...new Set(input.unitIds)];
  if (ids.length === 0) throw new ErrorProforma('Elige al menos una unidad');
  const unidades = await prisma.unit.findMany({
    where: { id: { in: ids }, projectId: lead.projectId },
    include: { typologyRef: { select: { name: true, bathrooms: true, bedrooms: true } } },
  });
  if (unidades.length !== ids.length) throw new ErrorProforma('Alguna unidad no pertenece al proyecto del lead');
  const noDisponibles = unidades.filter((u) => u.status !== 'disponible');
  if (noDisponibles.length) {
    throw new ErrorProforma(
      `No se puede cotizar: ${noDisponibles.map((u) => `${u.code} (${u.status.replace('_', ' ')})`).join(', ')}`,
      409
    );
  }
  const sinPrecio = unidades.filter((u) => u.price == null);
  if (sinPrecio.length) {
    throw new ErrorProforma(`Sin precio de lista: ${sinPrecio.map((u) => u.code).join(', ')}. Cárgalo en el proyecto.`);
  }

  const items: ItemProforma[] = unidades
    .sort((a, b) => orden(a.kind) - orden(b.kind) || a.code.localeCompare(b.code))
    .map((u) => ({
      unitId: u.id,
      kind: u.kind,
      code: u.code,
      typology: u.typologyRef?.name ?? u.typology ?? null,
      bedrooms: u.bedrooms ?? u.typologyRef?.bedrooms ?? null,
      bathrooms: u.bathrooms ?? u.typologyRef?.bathrooms ?? null,
      areaM2: u.areaM2 == null ? null : Number(u.areaM2),
      price: Number(u.price),
    }));
  const currency = unidades[0]!.currency;
  const listTotal = redondear(items.reduce((s, i) => s + i.price, 0));

  // Descuento: porcentaje manda; el monto se traduce a porcentaje para validar el tope.
  let discountPct = 0;
  let discountAmount = 0;
  if (input.discountPct != null && input.discountPct > 0) {
    discountPct = redondear(input.discountPct);
    discountAmount = redondear((listTotal * discountPct) / 100);
  } else if (input.discountAmount != null && input.discountAmount > 0) {
    discountAmount = redondear(input.discountAmount);
    discountPct = listTotal > 0 ? redondear((discountAmount / listTotal) * 100) : 0;
  }
  if (discountAmount > listTotal) throw new ErrorProforma('El descuento supera el precio');
  const tope = await topeDescuento(input.userId, input.organizationId);
  if (tope != null && discountPct > tope + 0.005) {
    throw new ErrorProforma(`Tu descuento máximo es ${tope}% y pediste ${discountPct}%`, 403);
  }
  const finalTotal = redondear(listTotal - discountAmount);

  const ajustes = await leerAjustes(input.organizationId);
  const ahora = new Date();
  let validDays = input.validDays ?? ajustes.proformaValidezDias;
  let validUntil = new Date(ahora.getTime() + validDays * 24 * 60 * 60 * 1000);
  if (input.validUntil) {
    // Fin del día elegido, hora de Lima (UTC-5).
    const elegida = new Date(`${input.validUntil}T23:59:59-05:00`);
    if (Number.isNaN(elegida.getTime())) throw new ErrorProforma('Fecha de vencimiento inválida');
    if (elegida.getTime() < ahora.getTime()) throw new ErrorProforma('La fecha de vencimiento ya pasó');
    validUntil = elegida;
    validDays = Math.max(1, Math.ceil((elegida.getTime() - ahora.getTime()) / (24 * 60 * 60 * 1000)));
  }
  const note = (input.note ?? ajustes.proformaNota).trim();

  const asesor = await prisma.user.findUnique({ where: { id: input.userId }, select: { name: true, email: true, phone: true } });
  const client = {
    name: `${lead.contact.fname} ${lead.contact.lname ?? ''}`.trim(),
    phone: lead.contact.phone,
    email: lead.contact.email,
    document: lead.contact.document,
  };
  const agent = {
    name: input.agentName?.trim() || asesor?.name || '',
    email: asesor?.email ?? '',
    phone: input.agentPhone?.trim() || asesor?.phone || null,
  };

  /**
   * Correlativo por año, serializado: dos asesores emitiendo a la vez no pueden sacar el
   * mismo número. El bloqueo es la fila de la organización.
   */
  const year = ahora.getFullYear();
  const proforma = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${input.organizationId} FOR UPDATE`;
    const ultimo = await tx.proforma.findFirst({
      where: { organizationId: input.organizationId, year },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    const seq = (ultimo?.seq ?? 0) + 1;
    const number = `${year}-${String(seq).padStart(7, '0')}`;
    const relativa = path.posix.join(input.organizationId, 'proformas', String(year), `${number}.pdf`);
    return tx.proforma.create({
      data: {
        organizationId: input.organizationId,
        leadId: lead.id,
        projectId: lead.projectId!,
        createdById: input.userId,
        year,
        seq,
        number,
        client,
        agent,
        items: items as never,
        currency,
        listTotal,
        discountPct,
        discountAmount,
        finalTotal,
        validDays,
        validUntil,
        note,
        pdfPath: relativa,
      },
    });
  });

  await generarPdf({
    destino: rutaPrivada(proforma.pdfPath),
    number: proforma.number,
    fecha: ahora,
    validUntil,
    project: lead.project,
    client,
    agent,
    items,
    currency,
    listTotal,
    discountPct,
    discountAmount,
    finalTotal,
    note,
  });

  await prisma.activity.create({
    data: {
      leadId: lead.id,
      userId: input.userId,
      type: 'sistema',
      body: `Proforma ${proforma.number} emitida: ${items.map((i) => i.code).join(' + ')} · ${moneda(finalTotal, currency)}${discountPct ? ` (desc. ${discountPct}%)` : ''}`,
      meta: { proformaId: proforma.id } as never,
    },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { lastActivityAt: ahora } });

  return proforma;
}

function orden(kind: string) {
  return ['departamento', 'oficina', 'lote', 'otro', 'estacionamiento', 'deposito'].indexOf(kind);
}

export function moneda(n: number, currency: string) {
  const simbolo = currency === 'USD' ? 'US$' : 'S/';
  return `${simbolo} ${n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fechaCorta(d: Date) {
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima' });
}

interface DatosPdf {
  destino: string;
  number: string;
  fecha: Date;
  validUntil: Date;
  project: { name: string; address: string | null; legalName: string | null; ruc: string | null; district: string | null; logoUrl: string | null };
  client: { name: string; phone: string | null; email: string | null; document: string | null };
  agent: { name: string; email: string; phone: string | null };
  items: ItemProforma[];
  currency: string;
  listTotal: number;
  discountPct: number;
  discountAmount: number;
  finalTotal: number;
  note: string;
}

/** Dibuja el PDF. Una página A4, el mismo orden de bloques que la proforma de Sperant. */
async function generarPdf(d: DatosPdf) {
  await fs.promises.mkdir(path.dirname(d.destino), { recursive: true });
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Proforma ${d.number}`, Author: d.project.legalName ?? d.project.name } });
  const salida = fs.createWriteStream(d.destino);
  const terminado = new Promise<void>((resolve, reject) => {
    salida.on('finish', () => resolve());
    salida.on('error', reject);
  });
  doc.pipe(salida);

  const LINEA = '#BBBBBB';
  const ancho = doc.page.width - 96;
  const x0 = 48;
  let y = 48;

  // Cabecera: logo a la izquierda, proyecto a la derecha.
  const logo = d.project.logoUrl ? path.resolve(uploadsDir, d.project.logoUrl) : null;
  if (logo && fs.existsSync(logo) && /\.(png|jpe?g)$/i.test(logo)) {
    try { doc.image(logo, x0, y, { fit: [110, 60] }); } catch { /* logo ilegible: se omite */ }
  }
  doc.font('Helvetica-Bold').fontSize(22).fillColor('#222222').text(d.project.name.toUpperCase(), x0, y, { width: ancho, align: 'right' });
  y = Math.max(doc.y, y + 64) + 10;
  doc.moveTo(x0, y).lineTo(x0 + ancho, y).lineWidth(2).strokeColor('#333333').stroke();
  y += 18;

  function titulo(t: string) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#222222').text(t, x0, y);
    y = doc.y + 8;
  }
  function par(etiqueta: string, valor: string | null | undefined) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222').text(etiqueta, x0, y, { width: 150, continued: false });
    doc.font('Helvetica').fontSize(10).fillColor('#222222').text(valor && valor.trim() ? valor : '-', x0 + 150, y, { width: ancho - 150 });
    y = doc.y + 3;
  }
  function separador() {
    y += 8;
    doc.moveTo(x0, y).lineTo(x0 + ancho, y).lineWidth(0.5).strokeColor(LINEA).stroke();
    y += 16;
  }

  titulo('Datos del cliente');
  par('Nombre (Titular):', d.client.name);
  par('Teléfono:', d.client.phone);
  par('Correo:', d.client.email);
  par('DNI:', d.client.document);
  separador();

  titulo('Datos de la(s) unidad(es)');
  const cols = [
    { t: 'Tipo de unidad', w: 0.30 },
    { t: 'Unidad', w: 0.11 },
    { t: 'Dorm.', w: 0.10 },
    { t: 'Baños', w: 0.10 },
    { t: 'Área (m²)', w: 0.17 },
    { t: 'Precio', w: 0.22 },
  ];
  const alto = 20;
  let cx = x0;
  doc.rect(x0, y, ancho, alto).fillAndStroke('#F0F0F0', LINEA);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#222222');
  for (const c of cols) {
    doc.text(c.t, cx + 4, y + 6, { width: ancho * c.w - 8, align: 'center' });
    cx += ancho * c.w;
  }
  y += alto;
  doc.font('Helvetica').fontSize(9.5);
  for (const it of d.items) {
    cx = x0;
    doc.rect(x0, y, ancho, alto).lineWidth(0.5).strokeColor(LINEA).stroke();
    const celdas = [
      `${KIND_ES[it.kind] ?? it.kind}${it.typology && it.kind === 'departamento' ? ` ${it.typology}` : ''}`,
      it.code,
      it.bedrooms != null ? String(it.bedrooms) : '-',
      it.bathrooms != null ? String(it.bathrooms) : '-',
      it.areaM2 != null ? `${it.areaM2.toFixed(2)} m²` : '-',
      moneda(it.price, d.currency),
    ];
    celdas.forEach((texto, i) => {
      doc.fillColor('#222222').text(texto, cx + 4, y + 6, { width: ancho * cols[i]!.w - 8, align: 'center', lineBreak: false, ellipsis: true });
      cx += ancho * cols[i]!.w;
    });
    y += alto;
  }
  separador();

  titulo('Precio de venta');
  par('Precio total:', moneda(d.listTotal, d.currency));
  if (d.discountAmount > 0) par(`Descuento (${d.discountPct}%):`, `- ${moneda(d.discountAmount, d.currency)}`);
  doc.font('Helvetica-Bold');
  par('Precio total final:', moneda(d.finalTotal, d.currency));
  separador();

  titulo('Datos de la inmobiliaria');
  par('Razón social:', d.project.legalName);
  par('RUC:', d.project.ruc);
  par('Asesor comercial:', d.agent.name);
  par('Teléfono:', d.agent.phone);
  if (d.agent.email) par('Correo:', d.agent.email);
  y += 14;

  // Número y fecha, caja a la derecha.
  const cajaW = 230;
  const cajaX = x0 + ancho - cajaW;
  doc.rect(cajaX, y, cajaW, 44).lineWidth(0.8).strokeColor('#222222').stroke();
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#222222').text('Cotización N°:', cajaX + 8, y + 8, { width: 110 });
  doc.font('Helvetica').text(d.number, cajaX + 118, y + 8, { width: cajaW - 126 });
  doc.font('Helvetica-Bold').text('Fecha:', cajaX + 8, y + 26, { width: 110 });
  doc.font('Helvetica').text(fechaCorta(d.fecha), cajaX + 118, y + 26, { width: cajaW - 126 });
  y += 60;

  // Nota legal en caja.
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#222222');
  const notaTexto = `Nota: ${d.note} Válida hasta el ${fechaCorta(d.validUntil)}.`;
  const altoNota = doc.heightOfString(notaTexto, { width: ancho - 16 }) + 14;
  doc.rect(x0, y, ancho, altoNota).lineWidth(0.8).strokeColor('#222222').stroke();
  doc.text(notaTexto, x0 + 8, y + 7, { width: ancho - 16, align: 'justify' });

  doc.end();
  await terminado;
}

export function rutaPdf(pdfPath: string) {
  return rutaPrivada(pdfPath);
}

export { privadosDir };
