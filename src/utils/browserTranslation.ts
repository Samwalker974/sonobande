import {
  buildParagraphSentencePlan,
  reassembleParagraphs,
  reassemblePartialParagraphs,
} from './translationChunker';

export interface BrowserTranslationResult {
  translatedTitle: string;
  translatedText: string;
}

export interface BrowserTranslationPartialResult {
  translatedTitle: string;
  translatedText: string;
  completedBlocks: number;
  totalBlocks: number;
}

export interface BrowserTranslationOptions {
  signal?: AbortSignal;
  onProgress?: (label: string | null) => void;
  onPartial?: (partial: BrowserTranslationPartialResult) => void;
}

export type TranslationBackendKind = 'webgpu' | 'wasm';

export type TranslationWorkerRequest =
  | { type: 'translate'; id: number; title: string; text: string }
  | { type: 'cancel'; id: number };

export type TranslationWorkerResponse =
  | { type: 'backend'; backend: TranslationBackendKind }
  | { type: 'progress'; id: number; label: string | null }
  | {
      type: 'partial';
      id: number;
      translatedTitle: string;
      translatedText: string;
      completedBlocks: number;
      totalBlocks: number;
    }
  | { type: 'result'; id: number; translatedTitle: string; translatedText: string }
  | { type: 'error'; id: number; message: string };

interface NativeTranslatorMonitor extends EventTarget {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: Event & { loaded?: number; total?: number }) => void
  ): void;
}

interface NativeTranslatorInstance {
  translate: (input: string, options?: { signal?: AbortSignal }) => Promise<string>;
  destroy?: () => void;
}

interface NativeTranslatorConstructor {
  availability: (options: {
    sourceLanguage: string;
    targetLanguage: string;
  }) => Promise<'unavailable' | 'downloadable' | 'downloading' | 'available'>;
  create: (options: {
    sourceLanguage: string;
    targetLanguage: string;
    signal?: AbortSignal;
    monitor?: (monitor: NativeTranslatorMonitor) => void;
  }) => Promise<NativeTranslatorInstance>;
}

interface PendingTranslation {
  resolve: (result: BrowserTranslationResult) => void;
  reject: (error: Error) => void;
  onProgress?: (label: string | null) => void;
  onPartial?: (partial: BrowserTranslationPartialResult) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

interface WorkerSlot {
  worker: Worker;
  pending: Map<number, PendingTranslation>;
}

const MAX_PARALLEL_WASM_WORKERS = 2;
const PARALLEL_SPLIT_MIN_CHARS = 1800;
const NATIVE_TRANSLATE_CONCURRENCY = 4;

const workerSlots: Array<WorkerSlot | null> = [null, null];
let detectedWorkerBackend: TranslationBackendKind | null = null;
let nextRequestId = 0;

let nativeTranslatorPromise: Promise<NativeTranslatorInstance> | null = null;
let nativeTranslatorPermanentlyUnavailable = false;

export function resetTranslationRuntimeForTests(): void {
  for (let i = 0; i < workerSlots.length; i++) {
    const slot = workerSlots[i];
    if (slot) {
      slot.worker.terminate();
      workerSlots[i] = null;
    }
  }
  detectedWorkerBackend = null;
  nativeTranslatorPromise = null;
  nativeTranslatorPermanentlyUnavailable = false;
}

function getNativeTranslatorCtor(): NativeTranslatorConstructor | null {
  if (nativeTranslatorPermanentlyUnavailable) return null;
  const ctor = (globalThis as { Translator?: NativeTranslatorConstructor }).Translator;
  if (!ctor || typeof ctor.availability !== 'function' || typeof ctor.create !== 'function') {
    return null;
  }
  return ctor;
}

async function acquireNativeTranslator(
  options: BrowserTranslationOptions
): Promise<NativeTranslatorInstance | null> {
  const ctor = getNativeTranslatorCtor();
  if (!ctor) return null;

  if (nativeTranslatorPromise) {
    try {
      return await nativeTranslatorPromise;
    } catch {
      nativeTranslatorPromise = null;
    }
  }

  try {
    const availability = await ctor.availability({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    });
    if (availability === 'unavailable') {
      nativeTranslatorPermanentlyUnavailable = true;
      return null;
    }

    let maxNativeDownloadPct = -1;
    const createPromise = ctor.create({
      sourceLanguage: 'en',
      targetLanguage: 'fr',
      signal: options.signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          if (typeof event.loaded === 'number') {
            const pct =
              typeof event.total === 'number' && event.total > 0
                ? Math.round((event.loaded / event.total) * 100)
                : Math.round(event.loaded * 100);
            const clamped = Math.min(100, Math.max(0, pct));
            if (clamped > maxNativeDownloadPct) {
              maxNativeDownloadPct = clamped;
              options.onProgress?.(`Téléchargement du traducteur natif — ${clamped} %`);
            }
          }
        });
      },
    });

    nativeTranslatorPromise = createPromise;
    return await createPromise;
  } catch (error) {
    nativeTranslatorPromise = null;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }
    // E.g. NotAllowedError when background prefetch tries to download without user gesture:
    // fall back seamlessly to the ONNX worker without permanently disabling native API.
    return null;
  }
}

async function translateWithNativeApi(
  translator: NativeTranslatorInstance,
  title: string,
  text: string,
  options: BrowserTranslationOptions
): Promise<BrowserTranslationResult> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    throw new Error('Le chapitre ne contient aucun texte à traduire.');
  }

  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // Split exceptionally long paragraphs (> 2400 chars) cleanly so native translation stays snappy
  const blocks: string[] = [];
  const paragraphOffsets: Array<{ start: number; count: number }> = [];
  for (const para of rawParagraphs) {
    const start = blocks.length;
    if (para.length <= 2400) {
      blocks.push(para);
    } else {
      const subPlan = buildParagraphSentencePlan(para);
      blocks.push(...subPlan.sentences);
    }
    const count = blocks.length - start;
    if (count > 0) {
      paragraphOffsets.push({ start, count });
    }
  }

  const cleanTitle = title.trim();
  const inputs = cleanTitle ? [cleanTitle, ...blocks] : blocks;
  const outputs = new Array<string | undefined>(inputs.length);
  let nextIdx = 0;
  let completed = 0;

  options.onProgress?.(`Traduction rapide (navigateur) — 0 % (0/${inputs.length})`);

  const runWorkerLoop = async () => {
    while (nextIdx < inputs.length) {
      if (options.signal?.aborted) {
        throw new DOMException('Traduction annulée', 'AbortError');
      }
      const currentIdx = nextIdx++;
      const translated = (
        await translator.translate(inputs[currentIdx], { signal: options.signal })
      ).trim();
      if (!translated) {
        throw new Error('Le traducteur natif du navigateur a renvoyé un texte vide.');
      }
      outputs[currentIdx] = translated;
      completed++;
      const pct = Math.round((completed / inputs.length) * 100);
      options.onProgress?.(
        `Traduction rapide (navigateur) — ${pct} % (${completed}/${inputs.length})`
      );
      if (options.onPartial) {
        const partialTitle = cleanTitle ? (outputs[0] ?? title) : title;
        const partialBlocks = cleanTitle ? outputs.slice(1) : outputs;
        const partialText = reassemblePartialParagraphs(partialBlocks, paragraphOffsets);
        if (partialText) {
          options.onPartial({
            translatedTitle: partialTitle,
            translatedText: partialText,
            completedBlocks: completed,
            totalBlocks: inputs.length,
          });
        }
      }
    }
  };

  const concurrency = Math.min(NATIVE_TRANSLATE_CONCURRENCY, inputs.length);
  await Promise.all(Array.from({ length: concurrency }, () => runWorkerLoop()));

  if (options.signal?.aborted) {
    throw new DOMException('Traduction annulée', 'AbortError');
  }

  options.onProgress?.(null);
  const finalOutputs = outputs.map((item) => item ?? '');
  const translatedTitle = cleanTitle ? finalOutputs[0] : title;
  const translatedBlocks = cleanTitle ? finalOutputs.slice(1) : finalOutputs;
  return {
    translatedTitle,
    translatedText: reassembleParagraphs(translatedBlocks, paragraphOffsets),
  };
}

function finishTranslation(
  slot: WorkerSlot,
  requestId: number,
  callback: (pending: PendingTranslation) => void
): void {
  const pending = slot.pending.get(requestId);
  if (!pending) return;

  slot.pending.delete(requestId);
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler);
  }
  callback(pending);
}

function failWorkerSlot(slotIndex: number, slot: WorkerSlot, message: string): void {
  if (workerSlots[slotIndex] !== slot) return;

  slot.worker.terminate();
  workerSlots[slotIndex] = null;
  for (const [requestId] of slot.pending) {
    finishTranslation(slot, requestId, ({ reject, onProgress }) => {
      onProgress?.(null);
      reject(new Error(message));
    });
  }
}

function getWorkerSlot(slotIndex: number): WorkerSlot {
  const existing = workerSlots[slotIndex];
  if (existing) return existing;

  const worker = new Worker(new URL('../workers/translation.worker.ts', import.meta.url), {
    type: 'module',
  });
  const slot: WorkerSlot = {
    worker,
    pending: new Map(),
  };
  workerSlots[slotIndex] = slot;

  worker.onmessage = (event: MessageEvent<TranslationWorkerResponse>) => {
    const response = event.data;
    if (response.type === 'backend') {
      detectedWorkerBackend = response.backend;
      return;
    }

    const pending = slot.pending.get(response.id);
    if (!pending) return;

    if (response.type === 'progress') {
      pending.onProgress?.(response.label);
      return;
    }

    if (response.type === 'partial') {
      pending.onPartial?.({
        translatedTitle: response.translatedTitle,
        translatedText: response.translatedText,
        completedBlocks: response.completedBlocks,
        totalBlocks: response.totalBlocks,
      });
      return;
    }

    finishTranslation(slot, response.id, (current) => {
      current.onProgress?.(null);
      if (response.type === 'result') {
        current.resolve({
          translatedTitle: response.translatedTitle,
          translatedText: response.translatedText,
        });
      } else {
        current.reject(new Error(response.message));
      }
    });
  };

  worker.onerror = (event) => {
    event.preventDefault();
    failWorkerSlot(
      slotIndex,
      slot,
      event.message || 'Le moteur de traduction du navigateur a rencontré une erreur.'
    );
  };
  worker.onmessageerror = () => {
    failWorkerSlot(slotIndex, slot, 'La réponse du moteur de traduction est illisible.');
  };

  return slot;
}

function dispatchToWorkerSlot(
  slotIndex: number,
  title: string,
  text: string,
  options: BrowserTranslationOptions
): Promise<BrowserTranslationResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException('Traduction annulée', 'AbortError'));
  }

  const slot = getWorkerSlot(slotIndex);
  const requestId = ++nextRequestId;

  return new Promise((resolve, reject) => {
    const pending: PendingTranslation = {
      resolve,
      reject,
      onProgress: options.onProgress,
      onPartial: options.onPartial,
      signal: options.signal,
    };

    if (options.signal) {
      pending.abortHandler = () => {
        finishTranslation(slot, requestId, ({ reject: rejectPending, onProgress }) => {
          onProgress?.(null);
          try {
            slot.worker.postMessage({ type: 'cancel', id: requestId });
          } catch (error) {
            rejectPending(
              error instanceof Error ? error : new Error('Impossible d’annuler la traduction.')
            );
            return;
          }
          rejectPending(new DOMException('Traduction annulée', 'AbortError'));
        });
      };
      options.signal.addEventListener('abort', pending.abortHandler, { once: true });
    }

    slot.pending.set(requestId, pending);
    try {
      slot.worker.postMessage({ type: 'translate', id: requestId, title, text });
    } catch (error) {
      finishTranslation(slot, requestId, ({ reject: rejectPending }) => {
        rejectPending(
          error instanceof Error ? error : new Error('Impossible de démarrer la traduction.')
        );
      });
    }
  });
}

function splitParagraphsForParallelWasm(text: string): [string, string] | null {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length < 2) return null;

  const totalChars = paragraphs.reduce((sum, p) => sum + p.length, 0);
  if (totalChars < PARALLEL_SPLIT_MIN_CHARS) return null;

  const halfTarget = totalChars / 2;
  let running = 0;
  let splitIdx = 1;
  let bestDiff = Infinity;

  for (let i = 1; i < paragraphs.length; i++) {
    running += paragraphs[i - 1].length;
    const diff = Math.abs(running - halfTarget);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIdx = i;
    }
  }

  return [paragraphs.slice(0, splitIdx).join('\n\n'), paragraphs.slice(splitIdx).join('\n\n')];
}

function canUseParallelWasmPool(): boolean {
  if (detectedWorkerBackend !== 'wasm') return false;
  const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 2) : 2;
  return cores >= 4 && MAX_PARALLEL_WASM_WORKERS >= 2;
}

function translateWithWorkerPool(
  title: string,
  text: string,
  options: BrowserTranslationOptions
): Promise<BrowserTranslationResult> {
  // Tier 3 (parallel CPU WASM): when worker #0 confirmed CPU WASM on a >=4-core machine,
  // split large chapters across 2 parallel workers for ~2x throughput.
  if (canUseParallelWasmPool()) {
    const halves = splitParagraphsForParallelWasm(text);
    if (halves) {
      const [firstHalf, secondHalf] = halves;
      let firstCompleted = 0;
      let firstTotal = 1;
      let secondCompleted = 0;
      let secondTotal = 1;
      let latestFirstTitle = title;
      let latestFirstText = '';
      let maxCombinedPct = 0;

      const reportCombined = () => {
        const total = firstTotal + secondTotal;
        const done = firstCompleted + secondCompleted;
        const pct = Math.min(99, Math.max(maxCombinedPct, Math.round((done / Math.max(1, total)) * 100)));
        maxCombinedPct = pct;
        options.onProgress?.(`Traduction par petits blocs (parallèle) — ${pct} %`);
        if (latestFirstText) {
          options.onPartial?.({
            translatedTitle: latestFirstTitle,
            translatedText: latestFirstText,
            completedBlocks: done,
            totalBlocks: total,
          });
        }
      };

      return Promise.all([
        dispatchToWorkerSlot(0, title, firstHalf, {
          signal: options.signal,
          onPartial: (partial) => {
            firstCompleted = partial.completedBlocks;
            firstTotal = Math.max(1, partial.totalBlocks);
            latestFirstTitle = partial.translatedTitle;
            latestFirstText = partial.translatedText;
            reportCombined();
          },
        }),
        dispatchToWorkerSlot(1, '', secondHalf, {
          signal: options.signal,
          onPartial: (partial) => {
            secondCompleted = partial.completedBlocks;
            secondTotal = Math.max(1, partial.totalBlocks);
            reportCombined();
          },
        }),
      ]).then(([firstRes, secondRes]) => {
        options.onProgress?.(null);
        return {
          translatedTitle: firstRes.translatedTitle,
          translatedText: `${firstRes.translatedText}\n\n${secondRes.translatedText}`,
        };
      });
    }
  }

  // Tier 2 (WebGPU) or single-worker WASM
  return dispatchToWorkerSlot(0, title, text, options);
}

export function translateInBrowser(
  title: string,
  text: string,
  options: BrowserTranslationOptions = {}
): Promise<BrowserTranslationResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException('Traduction annulée', 'AbortError'));
  }

  // Tier 1: Built-in browser Translator API (Chrome 138+ / Edge 148+, native on-device C++)
  if (getNativeTranslatorCtor()) {
    return (async () => {
      const nativeTranslator = await acquireNativeTranslator(options);
      if (nativeTranslator) {
        try {
          return await translateWithNativeApi(nativeTranslator, title, text, options);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            options.onProgress?.(null);
            throw error;
          }
          // Fall through cleanly to ONNX WebGPU / WASM worker
          nativeTranslatorPromise = null;
        }
      }
      return translateWithWorkerPool(title, text, options);
    })();
  }

  return translateWithWorkerPool(title, text, options);
}
