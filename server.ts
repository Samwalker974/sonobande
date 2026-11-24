import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import {
  buildParagraphSentencePlan,
  reassembleParagraphs,
} from './src/utils/translationChunker';
import { polishFrenchTitle, polishFrenchTranslation } from './src/utils/frenchPolish';
import { sanitizeTextForSpeech, stripParasiticCharacters } from './src/utils/speechSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_NEURAL_VOICES = new Set([
  'fr-FR-DeniseNeural',
  'fr-FR-HenriNeural',
  'fr-FR-VivienneMultilingualNeural',
  'fr-FR-RemyMultilingualNeural',
  'fr-FR-EloiseNeural',
]);

function splitFrenchTextIntoChunks(text: string, maxChars = 1400): string[] {
  const cleaned = text.trim();
  if (cleaned.length <= maxChars) {
    return [cleaned];
  }

  const chunks: string[] = [];
  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const para of paragraphs) {
    if ((current + ' ' + para).trim().length <= maxChars) {
      current = current ? `${current}\n${para}` : para;
      continue;
    }

    pushCurrent();
    if (para.length <= maxChars) {
      current = para;
      continue;
    }

    // Split long paragraph by sentence boundaries
    const sentences = para.match(/[^.!?…]+[.!?…]*/g) ?? [para];
    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if ((current + ' ' + sentence).trim().length <= maxChars) {
        current = current ? `${current} ${sentence}` : sentence;
      } else {
        pushCurrent();
        if (sentence.length <= maxChars) {
          current = sentence;
        } else {
          // Hard split very long unbroken text by words
          const words = sentence.split(/\s+/);
          for (const word of words) {
            if ((current + ' ' + word).trim().length <= maxChars) {
              current = current ? `${current} ${word}` : word;
            } else {
              pushCurrent();
              current = word;
            }
          }
        }
      }
    }
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [cleaned];
}

function buildWavBuffer(
  pcmData: Buffer,
  sampleRate: number,
  numChannels: number,
  bitsPerSample: number
): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function sanitizeTextForNeuralSsml(text: string): string {
  return sanitizeTextForSpeech(text)
    // Escape XML reserved chars just in case any remain before SSML serialization
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesizeNeuralChunkWithRetry(
  text: string,
  voiceName: string,
  maxRetries = 2
): Promise<Buffer> {
  const safeText = sanitizeTextForNeuralSsml(text);
  if (!safeText) {
    throw new Error('Texte vide pour la synthèse neuronale.');
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const tts = new MsEdgeTTS({
      connectionTimeoutMs: 12000,
      synthesisTimeoutMs: 30000,
    });
    try {
      await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(safeText);
      const chunks: Buffer[] = [];
      for await (const chunk of audioStream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const mp3Buffer = Buffer.concat(chunks);
      if (mp3Buffer.length === 0) {
        throw new Error("Le moteur neuronal n'a renvoyé aucune donnée audio.");
      }
      return mp3Buffer;
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, 450 * (attempt + 1)));
    } finally {
      try {
        tts.close();
      } catch {
        // Ignore close errors
      }
    }
  }

  throw lastError;
}

const TRANSLATE_SYSTEM_INSTRUCTION =
  "Tu es un traducteur littéraire francophone chevronné (anglais → français). Reformule fidèlement chaque idée dans un français idiomatique, élégant, naturel et fluide à l'oral. Évite absolument le mot-à-mot et les calques syntaxiques de l'anglais : privilégie des tournures authentiquement françaises, respecte les temps narratifs (imparfait pour les descriptions et ambiances), utilise des guillemets français (« ») pour les dialogues et conserve exactement la structure en paragraphes. Ne résume jamais, n'omets aucune phrase et n'ajoute aucun commentaire. Renvoie uniquement la traduction française.";

const TRANSLATE_WITH_TITLE_SYSTEM_INSTRUCTION =
  "Tu es un traducteur littéraire francophone chevronné (anglais → français). On te fournit un titre de chapitre puis le texte du chapitre. Traduis le titre et le texte dans un français idiomatique, élégant et naturel à lire à voix haute, en évitant les calques de l'anglais et en respectant les temps narratifs français ainsi que les sauts de paragraphes. Réponds strictement au format :\nTITRE: <titre traduit en français naturel sur une seule ligne>\nTEXTE:\n<texte intégral traduit en français idiomatique>\nN'ajoute aucun commentaire ni explication.";

function splitTextForTranslation(text: string, maxChars = 12000): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (cleaned.length <= maxChars) return [cleaned];

  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
  };

  for (const para of paragraphs) {
    if (!current && para.length <= maxChars) {
      current = para;
      continue;
    }
    if (current && current.length + 2 + para.length <= maxChars) {
      current = `${current}\n\n${para}`;
      continue;
    }

    pushCurrent();
    if (para.length <= maxChars) {
      current = para;
      continue;
    }

    const subChunks = splitFrenchTextIntoChunks(para, maxChars);
    chunks.push(...subChunks);
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [cleaned];
}

function parseTitleAndTextResponse(
  rawResponse: string,
  fallbackTitle: string
): { translatedTitle: string; translatedText: string } {
  const match = rawResponse.match(/^\s*TITRE\s*:\s*([^\n]+)\n+\s*TEXTE\s*:\s*\n?([\s\S]+)$/i);
  if (match) {
    const cleanTitle = match[1].replace(/^["«»]+|["«»]+$/g, '').trim();
    const cleanText = match[2].trim();
    if (cleanText) {
      return {
        translatedTitle: cleanTitle || fallbackTitle,
        translatedText: cleanText,
      };
    }
  }
  return {
    translatedTitle: fallbackTitle,
    translatedText: rawResponse.trim(),
  };
}

// Track models that hit a daily Free Tier quota so we don't keep hammering them
const modelDailyQuotaCooldownUntil = new Map<string, number>();

function isDailyQuotaExhaustedMessage(errMsg: string): boolean {
  return (
    errMsg.includes('GenerateRequestsPerDay') ||
    errMsg.includes('requests per day') ||
    errMsg.includes('free_tier_requests')
  );
}

function isQuotaErrorMessage(errMsg: string): boolean {
  return errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('429');
}

async function generateTranslationWithRetry(
  ai: GoogleGenAI,
  text: string,
  systemInstruction: string
): Promise<string> {
  // Prefer gemini-3.1-flash-lite first (high-throughput, much larger Free Tier quota)
  // and fall back to gemini-4-hydrogen if needed.
  const candidates: Array<{ model: string; useThinking: boolean }> = [
    { model: 'gemini-3.1-flash-lite', useThinking: false },
    { model: 'gemini-4-hydrogen', useThinking: true },
  ];

  const now = Date.now();
  const activeCandidates = candidates.filter((c) => {
    const until = modelDailyQuotaCooldownUntil.get(c.model) ?? 0;
    return now >= until;
  });

  // If all models are currently in cooldown, still try primary once in case quota reset or key changed
  const ordered = activeCandidates.length > 0 ? activeCandidates : [candidates[0]];

  let lastError: unknown;

  for (let i = 0; i < ordered.length; i++) {
    const { model, useThinking } = ordered[i];
    const maxAttemptsPerModel = 2;

    for (let attempt = 0; attempt < maxAttemptsPerModel; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: text,
          config: useThinking
            ? {
                systemInstruction,
                thinkingConfig: {
                  thinkingLevel: ThinkingLevel.LOW,
                },
              }
            : {
                systemInstruction,
              },
        });

        const translated = response.text?.trim();
        if (!translated) {
          throw new Error("Le service de traduction n'a renvoyé aucun texte.");
        }

        return translated;
      } catch (error) {
        lastError = error;
        const errMsg = error instanceof Error ? error.message : String(error);

        if (isQuotaErrorMessage(errMsg)) {
          if (isDailyQuotaExhaustedMessage(errMsg)) {
            // Put this model on a 10-minute cooldown so we route directly to the fallback model
            modelDailyQuotaCooldownUntil.set(model, Date.now() + 10 * 60 * 1000);
          }
          // Do not retry the same quota-exhausted model; move immediately to next candidate
          break;
        }

        const isTransient =
          errMsg.includes('503') ||
          errMsg.includes('500') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand') ||
          errMsg.includes('timeout');

        if (!isTransient) {
          // Move to fallback model if available (e.g. 404 or model-specific issue)
          break;
        }

        if (attempt < maxAttemptsPerModel - 1) {
          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      }
    }
  }

  throw lastError;
}

type LocalTranslationResult =
  | { translation_text?: string }
  | Array<{ translation_text?: string }>;
type LocalTranslatorFn = (
  input: string | string[],
  options?: Record<string, unknown>
) => Promise<LocalTranslationResult>;

let localTranslatorPromise: Promise<LocalTranslatorFn> | null = null;

function getLocalOpusTranslator(): Promise<LocalTranslatorFn> {
  if (!localTranslatorPromise) {
    localTranslatorPromise = import('@huggingface/transformers')
      .then(({ env: hfEnv, pipeline }) => {
        hfEnv.cacheDir = '/tmp/sonobande-hf-cache';
        return pipeline('translation', 'Xenova/opus-mt-en-fr', {
          dtype: 'fp32',
        }) as Promise<unknown>;
      })
      .then((fn) => fn as LocalTranslatorFn)
      .catch((err) => {
        localTranslatorPromise = null;
        throw err;
      });
  }
  return localTranslatorPromise;
}

async function translateWithLocalOpusMt(
  rawTitle: string,
  rawText: string
): Promise<{ translatedTitle: string; translatedText: string }> {
  const cleanSourceTitle = stripParasiticCharacters(rawTitle);
  const cleanSourceText = stripParasiticCharacters(rawText);
  const translator = await getLocalOpusTranslator();
  const plan = buildParagraphSentencePlan(cleanSourceText);

  const hasTitle = Boolean(cleanSourceTitle.trim());
  const allInputs = hasTitle ? [cleanSourceTitle.trim(), ...plan.sentences] : [...plan.sentences];

  if (allInputs.length === 0) {
    return {
      translatedTitle: polishFrenchTitle(cleanSourceTitle || rawTitle),
      translatedText: cleanSourceText,
    };
  }

  const BATCH_SIZE = 6;
  const translatedAll: string[] = [];

  for (let i = 0; i < allInputs.length; i += BATCH_SIZE) {
    const batch = allInputs.slice(i, i + BATCH_SIZE);
    const result = await translator(batch, { max_new_tokens: 280 });
    const items = Array.isArray(result) ? result : [result];
    for (let j = 0; j < batch.length; j++) {
      const translated = items[j]?.translation_text?.trim();
      translatedAll.push(translated || batch[j]);
    }
  }

  const rawTranslatedTitle = hasTitle ? translatedAll[0] : cleanSourceTitle;
  const translatedBlocks = hasTitle ? translatedAll.slice(1) : translatedAll;
  const rawTranslatedText = reassembleParagraphs(translatedBlocks, plan.paragraphOffsets);

  return {
    translatedTitle: polishFrenchTitle(rawTranslatedTitle || cleanSourceTitle || rawTitle),
    translatedText: polishFrenchTranslation(rawTranslatedText || cleanSourceText),
  };
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/tts-neural', async (req, res) => {
    try {
      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const voiceName =
        typeof req.body?.voiceName === 'string' && ALLOWED_NEURAL_VOICES.has(req.body.voiceName)
          ? req.body.voiceName
          : 'fr-FR-DeniseNeural';

      if (!rawText) {
        res.status(400).json({
          error: 'Veuillez saisir un texte avant de lancer la lecture.',
        });
        return;
      }

      if (rawText.length > 5000) {
        res.status(400).json({
          error: 'Le segment dépasse la limite maximale de 5 000 caractères.',
        });
        return;
      }

      const spokenText = sanitizeTextForSpeech(rawText);
      if (!spokenText) {
        const silentPcm = Buffer.alloc(24000 * 2 * 0.25); // 250ms clean silence
        const silentWav = buildWavBuffer(silentPcm, 24000, 1, 16);
        res.json({
          audioBase64: silentWav.toString('base64'),
          mimeType: 'audio/wav',
        });
        return;
      }

      const chunks = splitFrenchTextIntoChunks(spokenText, 1800);
      const mp3Buffers: Buffer[] = [];

      for (const chunk of chunks) {
        const buf = await synthesizeNeuralChunkWithRetry(chunk, voiceName);
        mp3Buffers.push(buf);
      }

      const combinedMp3 = Buffer.concat(mp3Buffers);
      res.json({
        audioBase64: combinedMp3.toString('base64'),
        mimeType: 'audio/mpeg',
      });
    } catch (error) {
      console.error('Erreur /api/tts-neural:', error);
      res.status(502).json({
        error:
          'Impossible de synthétiser la voix neuronale pour le moment. Réessayez dans quelques instants.',
      });
    }
  });

  app.post('/api/translate', async (req, res) => {
    try {
      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const requestedEngine = req.body?.engine === 'gemini' ? 'gemini' : 'local';

      if (!rawText) {
        res.status(400).json({
          error: 'Aucun texte à traduire.',
        });
        return;
      }

      if (rawText.length > 60000) {
        res.status(400).json({
          error: 'Ce chapitre dépasse la taille maximale de traduction par requête (60 000 caractères).',
        });
        return;
      }

      // Fast, unlimited, zero-quota local neural EN -> FR translation (Opus-MT)
      if (requestedEngine !== 'gemini') {
        try {
          const localResult = await translateWithLocalOpusMt(rawTitle, rawText);
          res.json({
            translatedTitle: localResult.translatedTitle,
            translatedText: localResult.translatedText,
            engineUsed: 'local-neural',
          });
          return;
        } catch (localErr) {
          console.warn(
            'Avertissement /api/translate: bascule sur Gemini suite à une erreur locale:',
            localErr instanceof Error ? localErr.message : String(localErr)
          );
        }
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        res.status(500).json({
          error:
            "La clé API Gemini n'est pas configurée côté serveur. Vérifiez les paramètres dans Settings > Secrets.",
        });
        return;
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const cleanSourceTitle = stripParasiticCharacters(rawTitle);
      const cleanSourceText = stripParasiticCharacters(rawText);
      const chunks = splitTextForTranslation(cleanSourceText || rawText, 12000);
      const translatedChunks: string[] = [];
      let translatedTitle = cleanSourceTitle || rawTitle;

      if (translatedTitle) {
        const combinedInput = `TITRE: ${translatedTitle}\n\nTEXTE:\n${chunks[0]}`;
        const rawFirst = await generateTranslationWithRetry(
          ai,
          combinedInput,
          TRANSLATE_WITH_TITLE_SYSTEM_INSTRUCTION
        );
        const parsed = parseTitleAndTextResponse(rawFirst, translatedTitle);
        translatedTitle = parsed.translatedTitle;
        translatedChunks.push(parsed.translatedText);
      } else {
        const firstTranslated = await generateTranslationWithRetry(
          ai,
          chunks[0],
          TRANSLATE_SYSTEM_INSTRUCTION
        );
        translatedChunks.push(firstTranslated);
      }

      for (let i = 1; i < chunks.length; i++) {
        const nextTranslated = await generateTranslationWithRetry(
          ai,
          chunks[i],
          TRANSLATE_SYSTEM_INSTRUCTION
        );
        translatedChunks.push(nextTranslated);
      }

      res.json({
        translatedTitle: polishFrenchTitle(translatedTitle),
        translatedText: polishFrenchTranslation(translatedChunks.join('\n\n')),
        engineUsed: 'gemini',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('API_KEY_INVALID') || message.includes('PERMISSION_DENIED')) {
        console.warn('Avertissement /api/translate: clé API refusée.');
        res.status(403).json({
          error:
            "Clé API Gemini refusée. Vérifiez la clé configurée dans Settings > Secrets.",
        });
        return;
      }
      if (isQuotaErrorMessage(message)) {
        console.warn('Avertissement /api/translate: quota Gemini atteint (429).');
        const isDaily = isDailyQuotaExhaustedMessage(message);
        res.status(429).json({
          quotaExceeded: true,
          error: isDaily
            ? 'Quota journalier gratuit Gemini atteint pour la traduction. Patientez jusqu’au renouvellement ou sélectionnez une clé API facturée dans Settings > Secrets pour augmenter votre limite.'
            : 'Quota de traduction Gemini atteint temporairement. Patientez quelques instants avant de réessayer.',
        });
        return;
      }
      if (message.includes('503') || message.includes('UNAVAILABLE')) {
        console.warn('Avertissement /api/translate: service momentanément indisponible (503).');
        res.status(503).json({
          error:
            'Le service de traduction est momentanément très sollicité. Patientez quelques secondes puis réessayez.',
        });
        return;
      }
      console.error('Erreur /api/translate:', error);
      res.status(502).json({
        error: 'Impossible de traduire ce chapitre pour le moment. Réessayez dans un instant.',
      });
    }
  });

  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';

    if (disableHmr) {
      // In Vite 8 middlewareMode with HMR disabled, /@vite/client still opens a WS to port 24678
      // and throws an unhandled rejection. Serve a clean zero-WebSocket client with full CSS support.
      const NO_HMR_VITE_CLIENT = `
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  } else {
    style.textContent = content;
  }
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay {}
`;
      app.get('/@vite/client', (_req, res) => {
        res.type('application/javascript; charset=utf-8').send(NO_HMR_VITE_CLIENT);
      });
    }

    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
        ws: disableHmr ? false : undefined,
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build non trouvé.');
      }
    });
  }

  const port = Number(process.env.PORT) || 3000;
  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`Sonobande prêt sur http://localhost:${port}`);
  });
}

createServer().catch((err) => {
  console.error('Échec du démarrage du serveur:', err);
  process.exit(1);
});
