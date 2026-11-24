import { pipeline } from '@huggingface/transformers';
import type {
  TranslationWorkerRequest,
  TranslationWorkerResponse,
} from '../utils/browserTranslation';
import {
  buildParagraphSentencePlan,
  reassembleParagraphs,
} from '../utils/translationChunker';

const MODEL_ID = 'Xenova/opus-mt-en-fr';
const BATCH_SIZE = 6;

function loadTranslator() {
  return pipeline('translation', MODEL_ID, {
    dtype: 'q8',
    progress_callback: (info) => {
      if (info.status === 'ready') {
        reportProgress(null);
      } else if (info.status === 'progress_total' || info.status === 'progress') {
        reportProgress(`Téléchargement du modèle de traduction — ${Math.round(info.progress)} %`);
      } else if (info.status === 'initiate' || info.status === 'download') {
        reportProgress('Chargement du modèle de traduction…');
      }
    },
  });
}

let translatorPromise: ReturnType<typeof loadTranslator> | null = null;
let translationQueue: Promise<void> = Promise.resolve();
const activeRequestIds = new Set<number>();
const cancelledRequestIds = new Set<number>();

function sendMessage(message: TranslationWorkerResponse): void {
  self.postMessage(message);
}

function reportProgress(label: string | null): void {
  for (const id of activeRequestIds) {
    if (!cancelledRequestIds.has(id)) {
      sendMessage({ type: 'progress', id, label });
    }
  }
}

function getTranslator(): ReturnType<typeof loadTranslator> {
  if (!translatorPromise) {
    translatorPromise = loadTranslator().catch((error: unknown) => {
      translatorPromise = null;
      throw error;
    });
  }
  return translatorPromise;
}

function isCancelled(requestId: number): boolean {
  return cancelledRequestIds.has(requestId);
}

async function translateRequest(
  request: Extract<TranslationWorkerRequest, { type: 'translate' }>
): Promise<void> {
  const plan = buildParagraphSentencePlan(request.text);
  if (plan.sentences.length === 0) {
    throw new Error('Le chapitre ne contient aucun texte à traduire.');
  }

  const cleanTitle = request.title.trim();
  const inputs = cleanTitle ? [cleanTitle, ...plan.sentences] : plan.sentences;
  const translator = await getTranslator();
  if (isCancelled(request.id)) return;

  const translatedInputs: string[] = [];
  for (let offset = 0; offset < inputs.length; offset += BATCH_SIZE) {
    if (isCancelled(request.id)) return;

    const batch = inputs.slice(offset, offset + BATCH_SIZE);
    const batchNumber = Math.floor(offset / BATCH_SIZE) + 1;
    const batchCount = Math.ceil(inputs.length / BATCH_SIZE);
    reportProgress(`Traduction en français — passage ${batchNumber} / ${batchCount}`);

    const outputs = await translator(batch, { max_new_tokens: 280 });
    if (outputs.length !== batch.length) {
      throw new Error('Le moteur de traduction a renvoyé un résultat incomplet.');
    }

    for (const output of outputs) {
      const translated = output.translation_text.trim();
      if (!translated) {
        throw new Error('Le moteur de traduction n’a renvoyé aucun texte.');
      }
      translatedInputs.push(translated);
    }
  }

  if (isCancelled(request.id)) return;

  const translatedTitle = cleanTitle ? translatedInputs[0] : request.title;
  const translatedBlocks = cleanTitle ? translatedInputs.slice(1) : translatedInputs;
  sendMessage({
    type: 'result',
    id: request.id,
    translatedTitle,
    translatedText: reassembleParagraphs(translatedBlocks, plan.paragraphOffsets),
  });
}

self.addEventListener('message', (event: MessageEvent<TranslationWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (activeRequestIds.has(request.id)) {
      cancelledRequestIds.add(request.id);
    }
    return;
  }

  activeRequestIds.add(request.id);
  translationQueue = translationQueue
    .then(async () => {
      try {
        await translateRequest(request);
      } catch (error) {
        if (!isCancelled(request.id)) {
          sendMessage({
            type: 'error',
            id: request.id,
            message:
              error instanceof Error
                ? error.message
                : 'Impossible de traduire ce chapitre dans le navigateur.',
          });
        }
      } finally {
        activeRequestIds.delete(request.id);
        cancelledRequestIds.delete(request.id);
      }
    });
});
