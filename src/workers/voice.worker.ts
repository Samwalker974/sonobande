import type { NeuralVoiceId } from '../types/walkman';
import type { VoiceWorkerRequest, VoiceWorkerResponse } from '../utils/browserVoice';

const MIN_VALID_ONNX_BYTES = 1_000_000;
const MIN_VALID_JSON_BYTES = 100;

let predictPromise: Promise<typeof import('@diffusionstudio/vits-web').predict> | null = null;
let synthesisQueue: Promise<void> = Promise.resolve();
const cancelledRequestIds = new Set<number>();

function sendMessage(message: VoiceWorkerResponse): void {
  self.postMessage(message);
}

function formatVoiceError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return `Impossible de générer la voix dans le navigateur (${error.trim()}).`;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) {
      return `Impossible de générer la voix dans le navigateur (${msg}).`;
    }
  }
  if (typeof error === 'number') {
    return `Impossible de générer la voix dans le navigateur (erreur WASM ${error}).`;
  }
  return 'Impossible de générer la voix dans le navigateur.';
}

async function purgeCorruptedCachedVoice(voiceId: NeuralVoiceId): Promise<void> {
  if (!self.navigator?.storage?.getDirectory) return;

  try {
    const root = await self.navigator.storage.getDirectory();
    const piperDir = await root.getDirectoryHandle('piper');

    try {
      const onnxHandle = await piperDir.getFileHandle(`${voiceId}.onnx`);
      const onnxFile = await onnxHandle.getFile();
      if (onnxFile.size < MIN_VALID_ONNX_BYTES) {
        await piperDir.removeEntry(`${voiceId}.onnx`);
      }
    } catch {
      // File not cached yet
    }

    try {
      const jsonHandle = await piperDir.getFileHandle(`${voiceId}.onnx.json`);
      const jsonFile = await jsonHandle.getFile();
      if (jsonFile.size < MIN_VALID_JSON_BYTES) {
        await piperDir.removeEntry(`${voiceId}.onnx.json`);
      } else {
        JSON.parse(await jsonFile.text());
      }
    } catch {
      try {
        await piperDir.removeEntry(`${voiceId}.onnx.json`);
      } catch {
        // File not cached yet
      }
    }
  } catch {
    // piper directory not created yet
  }
}

function getPredict(): Promise<typeof import('@diffusionstudio/vits-web').predict> {
  if (!predictPromise) {
    try {
      Object.defineProperty(self.navigator, 'hardwareConcurrency', {
        configurable: true,
        value: 1,
      });
    } catch (error) {
      return Promise.reject(
        error instanceof Error
          ? error
          : new Error('Impossible de configurer la synthèse vocale monothread.')
      );
    }

    predictPromise = import('@diffusionstudio/vits-web')
      .then(({ predict }) => predict)
      .catch((error: unknown) => {
        predictPromise = null;
        throw error;
      });
  }
  return predictPromise;
}

async function synthesize(text: string, voiceId: NeuralVoiceId): Promise<Blob> {
  await purgeCorruptedCachedVoice(voiceId);
  const predict = await getPredict();
  return predict({ text, voiceId });
}

self.addEventListener('message', (event: MessageEvent<VoiceWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelledRequestIds.add(request.id);
    return;
  }

  synthesisQueue = synthesisQueue.then(async () => {
    try {
      if (cancelledRequestIds.has(request.id)) return;

      const audio = await synthesize(request.text, request.voiceId);
      if (!cancelledRequestIds.has(request.id)) {
        sendMessage({ type: 'result', id: request.id, audio });
      }
    } catch (error) {
      if (!cancelledRequestIds.has(request.id)) {
        sendMessage({
          type: 'error',
          id: request.id,
          message: formatVoiceError(error),
        });
      }
    } finally {
      cancelledRequestIds.delete(request.id);
    }
  });
});
