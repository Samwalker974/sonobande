export interface BrowserTranslationResult {
  translatedTitle: string;
  translatedText: string;
}

export interface BrowserTranslationOptions {
  signal?: AbortSignal;
  onProgress?: (label: string | null) => void;
}

export type TranslationWorkerRequest =
  | { type: 'translate'; id: number; title: string; text: string }
  | { type: 'cancel'; id: number };

export type TranslationWorkerResponse =
  | { type: 'progress'; id: number; label: string | null }
  | { type: 'result'; id: number; translatedTitle: string; translatedText: string }
  | { type: 'error'; id: number; message: string };

interface PendingTranslation {
  resolve: (result: BrowserTranslationResult) => void;
  reject: (error: Error) => void;
  onProgress?: (label: string | null) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

let translationWorker: Worker | null = null;
let nextRequestId = 0;
const pendingTranslations = new Map<number, PendingTranslation>();

function finishTranslation(
  requestId: number,
  callback: (pending: PendingTranslation) => void
): void {
  const pending = pendingTranslations.get(requestId);
  if (!pending) return;

  pendingTranslations.delete(requestId);
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler);
  }
  callback(pending);
}

function failWorker(worker: Worker, message: string): void {
  if (translationWorker !== worker) return;

  worker.terminate();
  translationWorker = null;
  for (const [requestId] of pendingTranslations) {
    finishTranslation(requestId, ({ reject, onProgress }) => {
      onProgress?.(null);
      reject(new Error(message));
    });
  }
}

function getTranslationWorker(): Worker {
  if (translationWorker) return translationWorker;

  const worker = new Worker(new URL('../workers/translation.worker.ts', import.meta.url), {
    type: 'module',
  });
  translationWorker = worker;

  worker.onmessage = (event: MessageEvent<TranslationWorkerResponse>) => {
    const response = event.data;
    const pending = pendingTranslations.get(response.id);
    if (!pending) return;

    if (response.type === 'progress') {
      pending.onProgress?.(response.label);
      return;
    }

    finishTranslation(response.id, (current) => {
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
    failWorker(worker, event.message || 'Le moteur de traduction du navigateur a rencontré une erreur.');
  };
  worker.onmessageerror = () => {
    failWorker(worker, 'La réponse du moteur de traduction est illisible.');
  };

  return worker;
}

export function translateInBrowser(
  title: string,
  text: string,
  options: BrowserTranslationOptions = {}
): Promise<BrowserTranslationResult> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException('Traduction annulée', 'AbortError'));
  }

  const worker = getTranslationWorker();
  const requestId = ++nextRequestId;

  return new Promise((resolve, reject) => {
    const pending: PendingTranslation = {
      resolve,
      reject,
      onProgress: options.onProgress,
      signal: options.signal,
    };

    if (options.signal) {
      pending.abortHandler = () => {
        finishTranslation(requestId, ({ reject: rejectPending, onProgress }) => {
          onProgress?.(null);
          try {
            worker.postMessage({ type: 'cancel', id: requestId });
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

    pendingTranslations.set(requestId, pending);
    try {
      worker.postMessage({ type: 'translate', id: requestId, title, text });
    } catch (error) {
      finishTranslation(requestId, ({ reject: rejectPending }) => {
        rejectPending(
          error instanceof Error ? error : new Error('Impossible de démarrer la traduction.')
        );
      });
    }
  });
}
