import { env, pipeline } from '@huggingface/transformers';
import type {
  TranslationBackendKind,
  TranslationWorkerRequest,
  TranslationWorkerResponse,
} from '../utils/browserTranslation';
import {
  buildParagraphSentencePlan,
  buildProgressiveBatches,
  reassembleParagraphs,
  reassemblePartialParagraphs,
} from '../utils/translationChunker';

const MODEL_ID = 'Xenova/opus-mt-en-fr';
const WEBGPU_BATCH_SIZE = 4;
const WASM_BATCH_SIZE = 2;

interface LoadedTranslator {
  backend: TranslationBackendKind;
  run: Awaited<ReturnType<typeof createPipeline>>;
}

function getOptimalWasmThreads(): number {
  const isolated =
    typeof self !== 'undefined' &&
    Boolean(self.crossOriginIsolated) &&
    typeof SharedArrayBuffer === 'function';
  if (!isolated) return 1;
  const cores = self.navigator?.hardwareConcurrency ?? 2;
  // Use 2 threads per worker when parallel WASM pool can spin up 2 workers (4+ cores),
  // avoiding pthread barrier contention on small MarianMT matrices.
  return cores >= 4 ? 2 : Math.max(1, cores);
}

function configureWasmThreads(): void {
  if (env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = getOptimalWasmThreads();
  }
}

async function isWebGpuAvailable(): Promise<boolean> {
  const nav = self.navigator as Navigator & {
    gpu?: { requestAdapter: () => Promise<unknown> };
  };
  if (!nav?.gpu?.requestAdapter) return false;
  try {
    const adapter = await nav.gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

function createPipeline(device: TranslationBackendKind) {
  configureWasmThreads();
  const fileProgress = new Map<string, { loaded: number; total: number }>();
  let hasAggregatedTotal = false;
  let maxReportedPercent = -1;

  const emitDownloadPercent = (rawPercent: number) => {
    if (!Number.isFinite(rawPercent)) return;
    const clamped = Math.max(0, Math.min(100, Math.round(rawPercent)));
    if (clamped <= maxReportedPercent) return;
    maxReportedPercent = clamped;
    reportProgress(`Téléchargement du modèle de traduction — ${clamped} %`);
  };

  return pipeline('translation', MODEL_ID, {
    device,
    // WebGPU executes fp32 natively in GPU shaders without INT8 CPU-fallback ping-pong;
    // WASM uses compact q8 quantized kernels.
    dtype: device === 'webgpu' ? 'fp32' : 'q8',
    progress_callback: (info) => {
      if (info.status === 'ready') {
        reportProgress(null);
        return;
      }

      if (info.status === 'progress_total') {
        hasAggregatedTotal = true;
        emitDownloadPercent(info.progress);
        return;
      }

      if (info.status === 'progress') {
        // Ignore per-file progress once aggregated progress_total is available,
        // otherwise parallel file downloads make the percentage jump up and down.
        if (hasAggregatedTotal) return;
        const fileKey = 'file' in info && typeof info.file === 'string' ? info.file : 'model';
        const loaded = 'loaded' in info && typeof info.loaded === 'number' ? info.loaded : 0;
        const total = 'total' in info && typeof info.total === 'number' ? info.total : 0;
        if (total > 0) {
          fileProgress.set(fileKey, { loaded: Math.min(loaded, total), total });
          let sumLoaded = 0;
          let sumTotal = 0;
          for (const entry of fileProgress.values()) {
            sumLoaded += entry.loaded;
            sumTotal += entry.total;
          }
          if (sumTotal > 0) {
            emitDownloadPercent((sumLoaded / sumTotal) * 100);
          }
        } else {
          emitDownloadPercent(info.progress);
        }
        return;
      }

      if ((info.status === 'initiate' || info.status === 'download') && maxReportedPercent < 0) {
        reportProgress(
          device === 'webgpu'
            ? 'Chargement du modèle de traduction (WebGPU)…'
            : 'Chargement du modèle de traduction…'
        );
      }
    },
  });
}

let webGpuDisabled = false;
let translatorPromise: Promise<LoadedTranslator> | null = null;
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

async function loadBestTranslator(): Promise<LoadedTranslator> {
  if (!webGpuDisabled && (await isWebGpuAvailable())) {
    try {
      const run = await createPipeline('webgpu');
      sendMessage({ type: 'backend', backend: 'webgpu' });
      return { backend: 'webgpu', run };
    } catch {
      webGpuDisabled = true;
    }
  }

  const run = await createPipeline('wasm');
  sendMessage({ type: 'backend', backend: 'wasm' });
  return { backend: 'wasm', run };
}

function getTranslator(): Promise<LoadedTranslator> {
  if (!translatorPromise) {
    translatorPromise = loadBestTranslator().catch((error: unknown) => {
      translatorPromise = null;
      throw error;
    });
  }
  return translatorPromise;
}

function isCancelled(requestId: number): boolean {
  return cancelledRequestIds.has(requestId);
}

async function runBatchedTranslation(
  loaded: LoadedTranslator,
  request: Extract<TranslationWorkerRequest, { type: 'translate' }>,
  inputs: string[],
  cleanTitle: string,
  paragraphOffsets: Array<{ start: number; count: number }>
): Promise<string[] | null> {
  const batchSize = loaded.backend === 'webgpu' ? WEBGPU_BATCH_SIZE : WASM_BATCH_SIZE;
  const batches = buildProgressiveBatches(inputs, batchSize);
  const translatedInputs = new Array<string | undefined>(inputs.length);
  const modeTag = loaded.backend === 'webgpu' ? ' (WebGPU)' : '';
  let completedBlocks = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    if (isCancelled(request.id)) return null;

    const batch = batches[batchIdx];
    const startPercent = Math.round((completedBlocks / inputs.length) * 100);
    reportProgress(
      `Traduction par petits blocs${modeTag} — ${startPercent} % (${batchIdx + 1}/${batches.length})`
    );

    // Greedy decoding (num_beams: 1) avoids 4x beam-search overhead from Xenova/opus-mt-en-fr
    // while compact blocks + dynamic max_new_tokens keep every chunk fast.
    const outputs = await loaded.run(batch.items, {
      num_beams: 1,
      max_new_tokens: batch.maxNewTokens,
    });
    if (outputs.length !== batch.items.length) {
      throw new Error('Le moteur de traduction a renvoyé un résultat incomplet.');
    }

    for (let i = 0; i < outputs.length; i++) {
      const translated = outputs[i].translation_text.trim();
      if (!translated) {
        throw new Error('Le moteur de traduction n’a renvoyé aucun texte.');
      }
      translatedInputs[batch.originalIndices[i]] = translated;
    }

    completedBlocks += batch.items.length;
    const partialTitle = cleanTitle ? (translatedInputs[0] ?? request.title) : request.title;
    const partialBlocks = cleanTitle ? translatedInputs.slice(1) : translatedInputs;
    const partialText = reassemblePartialParagraphs(partialBlocks, paragraphOffsets);
    if (partialText && !isCancelled(request.id)) {
      sendMessage({
        type: 'partial',
        id: request.id,
        translatedTitle: partialTitle,
        translatedText: partialText,
        completedBlocks,
        totalBlocks: inputs.length,
      });
    }
  }

  return translatedInputs.map((item) => item ?? '');
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
  let loaded = await getTranslator();
  if (isCancelled(request.id)) return;

  let translatedInputs: string[] | null;
  try {
    translatedInputs = await runBatchedTranslation(
      loaded,
      request,
      inputs,
      cleanTitle,
      plan.paragraphOffsets
    );
  } catch (error) {
    // If WebGPU fails on runtime execution (e.g. unsupported op on a driver),
    // automatically fall back to WASM and retry transparently.
    if (loaded.backend === 'webgpu' && !isCancelled(request.id)) {
      webGpuDisabled = true;
      translatorPromise = null;
      loaded = await getTranslator();
      if (isCancelled(request.id)) return;
      translatedInputs = await runBatchedTranslation(
        loaded,
        request,
        inputs,
        cleanTitle,
        plan.paragraphOffsets
      );
    } else {
      throw error;
    }
  }

  if (!translatedInputs || isCancelled(request.id)) return;

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
  translationQueue = translationQueue.then(async () => {
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
