/**
 * Notas de voz: el asesor cuenta en 30 segundos cómo le fue con el cliente y el CRM lo
 * convierte en una actividad propuesta con su siguiente seguimiento.
 *
 * Dos pasos, en un job (`voz.procesar`) para no bloquear la subida:
 *  1. OpenAI transcribe el audio. Claude no recibe audio, por eso este paso va aparte.
 *  2. Claude resume la transcripción y propone tipo de contacto y siguiente paso.
 *
 * El resultado es una PROPUESTA. No se escribe en el historial del lead hasta que el
 * asesor la revisa y la registra: una fecha mal entendida («el martes» por «el jueves»)
 * no puede agendar sola un seguimiento.
 */
import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI, { toFile } from 'openai';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logError, logLine } from '../lib/log.js';
import { rutaPrivada } from '../lib/privados.js';

export interface Propuesta {
  resumen: string;
  tipo: 'llamada' | 'whatsapp' | 'email' | 'visita' | 'nota';
  siguientePaso: {
    tipo: 'llamada' | 'whatsapp' | 'email' | 'visita';
    /** ISO 8601 con zona de Lima, o null si la nota no dice cuándo. */
    cuando: string | null;
    descripcion: string;
  } | null;
}

/** Error que no se arregla reintentando: se anota en la nota y el job termina. */
class ErrorDefinitivo extends Error {}

const TIPOS_CONTACTO = ['llamada', 'whatsapp', 'email', 'visita'] as const;

const ESQUEMA = {
  type: 'object',
  properties: {
    resumen: {
      type: 'string',
      description: 'De 1 a 3 frases, en tercera persona, solo con lo que dice la nota.',
    },
    tipo: {
      type: 'string',
      enum: ['llamada', 'whatsapp', 'email', 'visita', 'nota'],
      description: 'Cómo fue el contacto que se describe. «nota» si no hubo contacto con el cliente.',
    },
    siguientePaso: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          properties: {
            tipo: { type: 'string', enum: [...TIPOS_CONTACTO] },
            cuando: {
              anyOf: [{ type: 'null' }, { type: 'string' }],
              description: 'Fecha y hora ISO 8601 con zona -05:00, o null si la nota no la indica.',
            },
            descripcion: { type: 'string' },
          },
          required: ['tipo', 'cuando', 'descripcion'],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ['resumen', 'tipo', 'siguientePaso'],
  additionalProperties: false,
} as const;

const SISTEMA = `Eres el asistente del CRM de una inmobiliaria en Lima, Perú. Un asesor de ventas grabó una nota de voz después de hablar con un cliente interesado en comprar. Recibes la transcripción y devuelves una propuesta de registro que el asesor revisará antes de guardarla.

- El resumen cuenta lo que pasó y lo que el cliente quiere (proyecto, tipología, presupuesto, objeciones, plazos) en 1 a 3 frases, sin adornos. No inventes datos que la nota no diga.
- El siguiente paso solo si la nota lo menciona o se desprende claramente (quedó en llamarlo, en mandarle la cotización, en visitar el piloto). Si no hay ninguno, devuelve null.
- Resuelve fechas relativas («mañana», «el jueves», «la próxima semana») contra la fecha actual que se te da. Si se dice el día pero no la hora, usa las 10:00. Si no se dice cuándo, deja «cuando» en null en vez de adivinar.
- La transcripción puede tener errores de reconocimiento de voz; interpreta nombres de proyectos y montos con sentido común.`;

/** Fecha y hora actual en Lima, con el día de la semana: sin él «el jueves» no se resuelve. */
function ahoraEnLima(): string {
  return new Date().toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function transcribir(audioPath: string, mime: string): Promise<string> {
  if (!env.voz.openaiKey) {
    throw new ErrorDefinitivo('Transcripción no configurada: falta OPENAI_API_KEY en el servidor.');
  }
  const openai = new OpenAI({ apiKey: env.voz.openaiKey });
  const nombre = 'nota.' + (mime === 'audio/webm' ? 'webm' : mime === 'audio/ogg' ? 'ogg' : mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : 'm4a');
  const archivo = await toFile(fs.createReadStream(rutaPrivada(audioPath)), nombre, { type: mime });

  try {
    const res = await openai.audio.transcriptions.create({
      file: archivo,
      model: env.voz.modeloTranscripcion,
      language: 'es',
      // Vocabulario del rubro: mejora cómo se escriben términos que el modelo oye mal.
      prompt: 'Conversación de ventas inmobiliarias en Lima: departamento, tipología, separación, cuota inicial, crédito hipotecario, Mivivienda, piloto, metraje.',
    });
    return res.text.trim();
  } catch (err) {
    // 4xx (salvo 429) no mejora reintentando: audio ilegible, key inválida, modelo inexistente.
    if (err instanceof OpenAI.APIError && err.status && err.status < 500 && err.status !== 429) {
      throw new ErrorDefinitivo(`OpenAI rechazó el audio (${err.status}): ${err.message}`);
    }
    throw err;
  }
}

async function proponer(
  transcripcion: string,
  contexto: { cliente: string; proyecto: string | null }
): Promise<Propuesta> {
  const anthropic = new Anthropic();
  try {
    const res = await anthropic.beta.messages.create({
      model: env.voz.modeloResumen,
      max_tokens: 2000,
      // Resumir y fechar una nota corta no necesita pensar mucho.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ESQUEMA as unknown as Record<string, unknown> },
      },
      // Si un clasificador rechazara la petición, se reintenta en el modelo que Anthropic
      // recomiende para esa categoría, en la misma llamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SISTEMA,
      messages: [
        {
          role: 'user',
          content:
            `Fecha y hora actual en Lima: ${ahoraEnLima()}\n` +
            `Cliente: ${contexto.cliente}.` +
            (contexto.proyecto ? ` Proyecto de interés: ${contexto.proyecto}.` : '') +
            `\n\nTranscripción de la nota de voz del asesor:\n<transcripcion>\n${transcripcion}\n</transcripcion>`,
        },
      ],
    });

    if (res.stop_reason === 'refusal') {
      throw new ErrorDefinitivo('Claude no pudo procesar esta nota.');
    }
    const texto = res.content.find((b) => b.type === 'text');
    if (!texto || texto.type !== 'text') throw new ErrorDefinitivo('Claude no devolvió una propuesta.');
    return JSON.parse(texto.text) as Propuesta;
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError || err instanceof Anthropic.APIConnectionError) {
      throw err; // transitorio: que la cola reintente
    }
    if (err instanceof Anthropic.APIError) {
      throw new ErrorDefinitivo(`Claude rechazó la petición (${err.status}): ${err.message}`);
    }
    throw err;
  }
}

/** Lo ejecuta la cola. Los errores transitorios se propagan para que reintente. */
export async function procesarNotaVoz(notaId: string): Promise<void> {
  const nota = await prisma.notaVoz.findUnique({
    where: { id: notaId },
    include: { lead: { include: { contact: true, project: { select: { name: true } } } } },
  });
  if (!nota || nota.status === 'lista') return;

  try {
    let transcript = nota.transcript;
    if (!transcript) {
      transcript = await transcribir(nota.audioPath, nota.mime);
      if (!transcript) throw new ErrorDefinitivo('No se entendió nada en la grabación.');
      await prisma.notaVoz.update({
        where: { id: nota.id },
        data: { transcript, status: 'transcrita', error: null },
      });
    }

    if (!env.voz.claudeActivo) {
      // Sin Claude queda la transcripción: sigue siendo útil para registrar a mano. El
      // error dice por qué no hay propuesta, y así la pantalla deja de esperarla.
      await prisma.notaVoz.update({
        where: { id: nota.id },
        data: { error: 'Resumen automático no configurado: falta ANTHROPIC_API_KEY en el servidor.' },
      });
      logLine(`voz: ${nota.id} transcrita, sin resumen (falta ANTHROPIC_API_KEY)`);
      return;
    }

    const propuesta = await proponer(transcript, {
      cliente: `${nota.lead.contact.fname} ${nota.lead.contact.lname ?? ''}`.trim(),
      proyecto: nota.lead.project?.name ?? null,
    });
    await prisma.notaVoz.update({
      where: { id: nota.id },
      data: { propuesta: propuesta as never, status: 'lista', error: null },
    });
    logLine(`voz: ${nota.id} lista`);
  } catch (err) {
    if (err instanceof ErrorDefinitivo) {
      await prisma.notaVoz.update({
        where: { id: nota.id },
        data: { status: nota.transcript ? 'transcrita' : 'error', error: err.message },
      });
      logError(`voz: ${nota.id}`, err.message);
      return;
    }
    await prisma.notaVoz.update({
      where: { id: nota.id },
      data: { error: 'Reintentando: ' + (err instanceof Error ? err.message : String(err)) },
    });
    throw err;
  }
}
