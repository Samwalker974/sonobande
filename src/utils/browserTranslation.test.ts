import assert from 'node:assert/strict';
import test from 'node:test';
import {
  translateInBrowser,
  type TranslationWorkerRequest,
  type TranslationWorkerResponse,
} from './browserTranslation';

test('translateInBrowser returns worker results, reports progress, and forwards cancellation', async () => {
  const messages: TranslationWorkerRequest[] = [];
  const fakeWorker = {
    onmessage: null as ((event: MessageEvent<TranslationWorkerResponse>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage(message: TranslationWorkerRequest) {
      messages.push(message);
      if (message.type !== 'translate' || message.text !== 'chapter text') return;

      queueMicrotask(() => {
        fakeWorker.onmessage?.(
          new MessageEvent('message', {
            data: { type: 'progress', id: message.id, label: 'Téléchargement — 50 %' },
          })
        );
        fakeWorker.onmessage?.(
          new MessageEvent('message', {
            data: {
              type: 'result',
              id: message.id,
              translatedTitle: 'Titre français',
              translatedText: 'Texte français',
            },
          })
        );
      });
    },
    terminate() {},
  };

  Reflect.set(globalThis, 'Worker', function WorkerStub() {
    return fakeWorker;
  });

  const progress: Array<string | null> = [];
  const result = await translateInBrowser('English title', 'chapter text', {
    onProgress: (label) => progress.push(label),
  });

  assert.deepEqual(result, {
    translatedTitle: 'Titre français',
    translatedText: 'Texte français',
  });
  assert.deepEqual(progress, ['Téléchargement — 50 %', null]);

  const controller = new AbortController();
  const cancelledTranslation = translateInBrowser('Title', 'another chapter', {
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(cancelledTranslation, { name: 'AbortError' });
  assert.deepEqual(
    messages.map((message) => message.type),
    ['translate', 'translate', 'cancel']
  );
});
