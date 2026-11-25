import type { NeuralVoiceId } from '../types/walkman';
import { encodeWavBuffer, parseWavBuffer } from './audioDsp';

export interface VoiceSynthesisPhrase {
  text: string;
  pauseAfter: boolean;
}

export interface SynthesizedPcmResult {
  samples: Float32Array;
  sampleRate: number;
  pauseOffsets: number[];
}

export interface SynthesizePcmOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export type VoiceWorkerRequest =
  | {
      type: 'synthesize';
      id: number;
      voiceId: NeuralVoiceId;
      text: string;
      phrases?: VoiceSynthesisPhrase[];
    }
  | { type: 'cancel'; id: number };

export type VoiceWorkerResponse =
  | {
      type: 'progress';
      id: number;
      completed: number;
      total: number;
    }
  | {
      type: 'result';
      id: number;
      pcmBuffer?: ArrayBuffer;
      sampleRate?: number;
      pauseOffsets?: number[];
      audio?: Blob;
    }
  | { type: 'error'; id: number; message: string };

interface PendingSynthesis {
  resolve: (result: VoiceWorkerResultPayload) => void;
  reject: (error: Error) => void;
  onProgress?: (completed: number, total: number) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

type VoiceWorkerResultPayload = Extract<VoiceWorkerResponse, { type: 'result' }>;

// The voice worker now reuses a single cached ONNX InferenceSession per voice and
// explicitly disposes tensors after each run, so it stays alive across syntheses.
let voiceWorker: Worker | null = null;
let nextRequestId = 0;
const pendingSyntheses = new Map<number, PendingSynthesis>();

export function disposeVoiceWorker(): void {
  if (voiceWorker) {
    voiceWorker.terminate();
    voiceWorker = null;
  }
}

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
    const pending = pendingSyntheses.get(response.id);
    if (!pending) return;

    if (response.type === 'progress') {
      pending.onProgress?.(response.completed, response.total);
      return;
    }

    finishSynthesis(response.id, ({ resolve, reject }) => {
      if (response.type === 'result') {
        resolve(response);
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

function requestSynthesisFromWorker(
  payload: {
    text: string;
    phrases?: VoiceSynthesisPhrase[];
    voiceId: NeuralVoiceId;
  },
  options: SynthesizePcmOptions = {}
): Promise<VoiceWorkerResultPayload> {
  if (options.signal?.aborted) {
    return Promise.reject(new DOMException('Synthèse annulée', 'AbortError'));
  }

  const worker = getVoiceWorker();
  const requestId = ++nextRequestId;

  return new Promise((resolve, reject) => {
    const pending: PendingSynthesis = {
      resolve,
      reject,
      onProgress: options.onProgress,
      signal: options.signal,
    };

    if (options.signal) {
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
      options.signal.addEventListener('abort', pending.abortHandler, { once: true });
    }

    pendingSyntheses.set(requestId, pending);
    try {
      const request: VoiceWorkerRequest = payload.phrases
        ? {
            type: 'synthesize',
            id: requestId,
            voiceId: payload.voiceId,
            text: payload.text,
            phrases: payload.phrases,
          }
        : {
            type: 'synthesize',
            id: requestId,
            voiceId: payload.voiceId,
            text: payload.text,
          };
      worker.postMessage(request);
    } catch (error) {
      finishSynthesis(requestId, ({ reject: rejectPending }) => {
        rejectPending(
          error instanceof Error ? error : new Error('Impossible de démarrer la synthèse vocale.')
        );
      });
    }
  });
}

/**
 * Synthesizes one string or an ordered list of phrases directly into mono Float32 PCM
 * via the persistent ONNX Piper worker (zero-copy ArrayBuffer transfer, no WAV round-trip).
 */
export async function synthesizePcmInBrowser(
  input: string | VoiceSynthesisPhrase[],
  voiceId: NeuralVoiceId,
  options: SynthesizePcmOptions = {}
): Promise<SynthesizedPcmResult> {
  const payload =
    typeof input === 'string'
      ? { text: input, voiceId }
      : {
          text: input.map((p) => p.text).join(' '),
          phrases: input,
          voiceId,
        };

  const response = await requestSynthesisFromWorker(payload, options);

  if (response.pcmBuffer && typeof response.sampleRate === 'number') {
    return {
      samples: new Float32Array(response.pcmBuffer),
      sampleRate: response.sampleRate,
      pauseOffsets: response.pauseOffsets ?? [],
    };
  }

  if (response.audio) {
    const wav = parseWavBuffer(await response.audio.arrayBuffer());
    return {
      samples: wav.samples,
      sampleRate: wav.sampleRate,
      pauseOffsets: response.pauseOffsets ?? [],
    };
  }

  throw new Error('La synthèse vocale n’a renvoyé aucune donnée audio.');
}

/**
 * Backward-compatible helper returning a WAV Blob.
 */
export async function synthesizeInBrowser(
  text: string,
  voiceId: NeuralVoiceId,
  signal?: AbortSignal
): Promise<Blob> {
  const response = await requestSynthesisFromWorker({ text, voiceId }, { signal });

  if (response.audio) {
    return response.audio;
  }

  if (response.pcmBuffer && typeof response.sampleRate === 'number') {
    const wavBuffer = encodeWavBuffer(new Float32Array(response.pcmBuffer), response.sampleRate);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  throw new Error('La synthèse vocale n’a renvoyé aucune donnée audio.');
}
