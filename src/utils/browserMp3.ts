export interface Mp3SegmentDspOptions {
  pauseOffsets: number[];
  speed: number;
  pitchSemitones: number;
  pauseDurationSeconds: number;
  includeEndPause: boolean;
  hdVoiceEnhanced?: boolean;
}

export type Mp3WorkerRequest =
  | { type: 'start'; requestId: number; sessionId: number; bitrateKbps: number }
  | ({
      type: 'append-wav';
      requestId: number;
      sessionId: number;
      wavBuffer: ArrayBuffer;
    } & Mp3SegmentDspOptions)
  | ({
      type: 'append-pcm';
      requestId: number;
      sessionId: number;
      pcmBuffer: ArrayBuffer;
      sampleRate: number;
    } & Mp3SegmentDspOptions)
  | { type: 'append-silence'; requestId: number; sessionId: number; seconds: number }
  | { type: 'finalize'; requestId: number; sessionId: number }
  | { type: 'cancel'; sessionId: number };

export type Mp3WorkerResponse =
  | { type: 'ack'; requestId: number }
  | { type: 'result'; requestId: number; mp3Buffer: ArrayBuffer }
  | { type: 'error'; requestId: number; message: string };

export interface BrowserMp3Session {
  appendWav: (wavBuffer: ArrayBuffer, options: Mp3SegmentDspOptions) => Promise<void>;
  appendPcm: (
    samples: Float32Array,
    sampleRate: number,
    options: Mp3SegmentDspOptions
  ) => Promise<void>;
  appendSilence: (seconds: number) => Promise<void>;
  finalize: () => Promise<Uint8Array>;
  cancel: () => void;
}

interface PendingMp3Request {
  resolve: (value: Uint8Array | void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

let mp3Worker: Worker | null = null;
let nextRequestId = 0;
let nextSessionId = 0;
const pendingRequests = new Map<number, PendingMp3Request>();

function finishRequest(
  requestId: number,
  callback: (pending: PendingMp3Request) => void
): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;

  pendingRequests.delete(requestId);
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler);
  }
  callback(pending);
}

function failWorker(worker: Worker, message: string): void {
  if (mp3Worker !== worker) return;

  worker.terminate();
  mp3Worker = null;
  for (const [requestId] of pendingRequests) {
    finishRequest(requestId, ({ reject }) => reject(new Error(message)));
  }
}

function getMp3Worker(): Worker {
  if (mp3Worker) return mp3Worker;

  const worker = new Worker(new URL('../workers/mp3.worker.ts', import.meta.url), {
    type: 'module',
  });
  mp3Worker = worker;

  worker.onmessage = (event: MessageEvent<Mp3WorkerResponse>) => {
    const response = event.data;
    if (!pendingRequests.has(response.requestId)) return;

    finishRequest(response.requestId, ({ resolve, reject }) => {
      if (response.type === 'ack') {
        resolve();
      } else if (response.type === 'result') {
        resolve(new Uint8Array(response.mp3Buffer));
      } else {
        reject(new Error(response.message));
      }
    });
  };

  worker.onerror = (event) => {
    event.preventDefault();
    failWorker(worker, event.message || 'Le moteur d’encodage MP3 a rencontré une erreur.');
  };
  worker.onmessageerror = () => {
    failWorker(worker, 'La réponse du moteur d’encodage MP3 est illisible.');
  };

  return worker;
}

function sendWorkerRequest<T extends Uint8Array | void>(
  worker: Worker,
  sessionId: number,
  buildMessage: (requestId: number) => {
    message: Exclude<Mp3WorkerRequest, { type: 'cancel' }>;
    transfer?: Transferable[];
  },
  signal?: AbortSignal,
  onCancelSession?: () => void
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Export annulé', 'AbortError'));
  }

  const requestId = ++nextRequestId;

  return new Promise<T>((resolve, reject) => {
    const pending: PendingMp3Request = {
      resolve: resolve as (value: Uint8Array | void) => void,
      reject,
      signal,
    };

    if (signal) {
      pending.abortHandler = () => {
        finishRequest(requestId, ({ reject: rejectPending }) => {
          onCancelSession?.();
          rejectPending(new DOMException('Export annulé', 'AbortError'));
        });
      };
      signal.addEventListener('abort', pending.abortHandler, { once: true });
    }

    pendingRequests.set(requestId, pending);

    try {
      const { message, transfer } = buildMessage(requestId);
      if (transfer && transfer.length > 0) {
        worker.postMessage(message, transfer);
      } else {
        worker.postMessage(message);
      }
    } catch (error) {
      finishRequest(requestId, ({ reject: rejectPending }) => {
        try {
          worker.postMessage({ type: 'cancel', sessionId });
        } catch {
          // Ignore cleanup postMessage failure
        }
        rejectPending(
          error instanceof Error ? error : new Error('Impossible de contacter le moteur MP3.')
        );
      });
    }
  });
}

export async function createBrowserMp3Session(options: {
  bitrateKbps?: number;
  signal?: AbortSignal;
} = {}): Promise<BrowserMp3Session> {
  const { bitrateKbps = 128, signal } = options;
  if (signal?.aborted) {
    throw new DOMException('Export annulé', 'AbortError');
  }

  const worker = getMp3Worker();
  const sessionId = ++nextSessionId;
  let closed = false;

  const cancel = () => {
    if (closed) return;
    closed = true;
    if (mp3Worker === worker) {
      try {
        worker.postMessage({ type: 'cancel', sessionId });
      } catch {
        // Ignore cleanup failure if worker already terminated
      }
    }
  };

  await sendWorkerRequest<void>(
    worker,
    sessionId,
    (requestId) => ({
      message: { type: 'start', requestId, sessionId, bitrateKbps },
    }),
    signal,
    cancel
  );

  return {
    appendWav(wavBuffer, dsp) {
      if (closed) {
        return Promise.reject(new DOMException('Export annulé', 'AbortError'));
      }
      const cloned = wavBuffer.slice(0);
      return sendWorkerRequest<void>(
        worker,
        sessionId,
        (requestId) => ({
          message: {
            type: 'append-wav',
            requestId,
            sessionId,
            wavBuffer: cloned,
            ...dsp,
          },
          transfer: [cloned],
        }),
        signal,
        cancel
      );
    },

    appendPcm(samples, sampleRate, dsp) {
      if (closed) {
        return Promise.reject(new DOMException('Export annulé', 'AbortError'));
      }
      const cloned = new Float32Array(samples);
      return sendWorkerRequest<void>(
        worker,
        sessionId,
        (requestId) => ({
          message: {
            type: 'append-pcm',
            requestId,
            sessionId,
            pcmBuffer: cloned.buffer,
            sampleRate,
            ...dsp,
          },
          transfer: [cloned.buffer],
        }),
        signal,
        cancel
      );
    },

    appendSilence(seconds) {
      if (closed) {
        return Promise.reject(new DOMException('Export annulé', 'AbortError'));
      }
      return sendWorkerRequest<void>(
        worker,
        sessionId,
        (requestId) => ({
          message: { type: 'append-silence', requestId, sessionId, seconds },
        }),
        signal,
        cancel
      );
    },

    async finalize() {
      if (closed) {
        throw new DOMException('Export annulé', 'AbortError');
      }
      try {
        return await sendWorkerRequest<Uint8Array>(
          worker,
          sessionId,
          (requestId) => ({
            message: { type: 'finalize', requestId, sessionId },
          }),
          signal,
          cancel
        );
      } finally {
        closed = true;
      }
    },

    cancel,
  };
}
