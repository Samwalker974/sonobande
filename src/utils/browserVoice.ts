import type { NeuralVoiceId } from '../types/walkman';

export type VoiceWorkerRequest =
  | { type: 'synthesize'; id: number; text: string; voiceId: NeuralVoiceId }
  | { type: 'cancel'; id: number };

export type VoiceWorkerResponse =
  | { type: 'result'; id: number; audio: Blob }
  | { type: 'error'; id: number; message: string };

interface PendingSynthesis {
  resolve: (audio: Blob) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

let voiceWorker: Worker | null = null;
let nextRequestId = 0;
const pendingSyntheses = new Map<number, PendingSynthesis>();

function finishSynthesis(
  requestId: number,
  callback: (pending: PendingSynthesis) => void
): void {
  const pending = pendingSyntheses.get(requestId);
  if (!pending) return;

  pendingSyntheses.delete(requestId);
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler);
  }
  callback(pending);
}

function failWorker(worker: Worker, message: string): void {
  if (voiceWorker !== worker) return;

  worker.terminate();
  voiceWorker = null;
  for (const [requestId] of pendingSyntheses) {
    finishSynthesis(requestId, ({ reject }) => reject(new Error(message)));
  }
}

function getVoiceWorker(): Worker {
  if (voiceWorker) return voiceWorker;

  const worker = new Worker(new URL('../workers/voice.worker.ts', import.meta.url), {
    type: 'module',
  });
  voiceWorker = worker;

  worker.onmessage = (event: MessageEvent<VoiceWorkerResponse>) => {
    const response = event.data;
    if (!pendingSyntheses.has(response.id)) return;

    finishSynthesis(response.id, ({ resolve, reject }) => {
      if (response.type === 'result') {
        resolve(response.audio);
      } else {
        reject(new Error(response.message));
      }
    });
  };

  worker.onerror = (event) => {
    event.preventDefault();
    failWorker(worker, event.message || 'Le moteur de synthèse vocale a rencontré une erreur.');
  };
  worker.onmessageerror = () => {
    failWorker(worker, 'La réponse du moteur de synthèse vocale est illisible.');
  };

  return worker;
}

export function synthesizeInBrowser(
  text: string,
  voiceId: NeuralVoiceId,
  signal?: AbortSignal
): Promise<Blob> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Synthèse annulée', 'AbortError'));
  }

  const worker = getVoiceWorker();
  const requestId = ++nextRequestId;

  return new Promise((resolve, reject) => {
    const pending: PendingSynthesis = { resolve, reject, signal };
    if (signal) {
      pending.abortHandler = () => {
        finishSynthesis(requestId, ({ reject: rejectPending }) => {
          try {
            worker.postMessage({ type: 'cancel', id: requestId });
          } catch (error) {
            rejectPending(
              error instanceof Error ? error : new Error('Impossible d’annuler la synthèse vocale.')
            );
            return;
          }
          rejectPending(new DOMException('Synthèse annulée', 'AbortError'));
        });
      };
      signal.addEventListener('abort', pending.abortHandler, { once: true });
    }

    pendingSyntheses.set(requestId, pending);
    try {
      worker.postMessage({ type: 'synthesize', id: requestId, text, voiceId });
    } catch (error) {
      finishSynthesis(requestId, ({ reject: rejectPending }) => {
        rejectPending(
          error instanceof Error ? error : new Error('Impossible de démarrer la synthèse vocale.')
        );
      });
    }
  });
}
