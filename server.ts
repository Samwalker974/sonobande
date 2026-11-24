import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildParagraphSentencePlan,
  reassembleParagraphs,
} from './src/utils/translationChunker';
import { polishFrenchTitle, polishFrenchTranslation } from './src/utils/frenchPolish';
import { stripParasiticCharacters } from './src/utils/speechSanitizer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

  app.post('/api/translate', async (req, res) => {
    try {
      const rawText = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const rawTitle = typeof req.body?.title === 'string' ? req.body.title.trim() : '';

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

      const localResult = await translateWithLocalOpusMt(rawTitle, rawText);
      res.json({
        translatedTitle: localResult.translatedTitle,
        translatedText: localResult.translatedText,
        engineUsed: 'local-neural',
      });
    } catch (error) {
      console.error('Erreur du moteur de traduction local:', error);
      res.status(503).json({
        error: 'Le moteur de traduction local est indisponible. Aucun service externe ne sera appelé.',
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
