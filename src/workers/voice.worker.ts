import type { NeuralVoiceId } from '../types/walkman';
import type { VoiceWorkerRequest, VoiceWorkerResponse } from '../utils/browserVoice';

let predictPromise: Promise<typeof import('@diffusionstudio/vits-web').predict> | null = null;
let synthesisQueue: Promise<void> = Promise.resolve();
const cancelledRequestIds = new Set<number>();

function sendMessage(message: VoiceWorkerResponse): void {
  self.postMessage(message);
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
          message:
            error instanceof Error
              ? error.message
              : 'Impossible de générer la voix dans le navigateur.',
        });
      }
    } finally {
      cancelledRequestIds.delete(request.id);
    }
  });
});
