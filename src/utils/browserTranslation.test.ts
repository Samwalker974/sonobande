import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resetTranslationRuntimeForTests,
  translateInBrowser,
  type TranslationWorkerRequest,
  type TranslationWorkerResponse,
} from './browserTranslation';

test('translateInBrowser returns worker results, reports progress, and forwards cancellation', async () => {
  resetTranslationRuntimeForTests();
  const originalWorker = globalThis.Worker;
  const originalTranslator = (globalThis as { Translator?: unknown }).Translator;
  Reflect.deleteProperty(globalThis, 'Translator');

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

  try {
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
  } finally {
    resetTranslationRuntimeForTests();
    Reflect.set(globalThis, 'Worker', originalWorker);
    if (originalTranslator !== undefined) {
      Reflect.set(globalThis, 'Translator', originalTranslator);
    }
  }
});

test('translateInBrowser uses native browser Translator API when available and falls back to worker on error', async () => {
  resetTranslationRuntimeForTests();
  const originalWorker = globalThis.Worker;
  const originalTranslator = (globalThis as { Translator?: unknown }).Translator;

  let workerCreatedCount = 0;
  Reflect.set(globalThis, 'Worker', function WorkerStub() {
    workerCreatedCount++;
    const worker = {
      onmessage: null as ((event: MessageEvent<TranslationWorkerResponse>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      onmessageerror: null as (() => void) | null,
      postMessage(message: TranslationWorkerRequest) {
        if (message.type !== 'translate') return;
        queueMicrotask(() => {
          worker.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'backend', backend: 'wasm' },
            })
          );
          worker.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'result',
                id: message.id,
                translatedTitle: `W:${message.title}`,
                translatedText: `W:${message.text}`,
              },
            })
          );
        });
      },
      terminate() {},
    };
    return worker;
  });

  try {
    // 1. Native Translator fast path
    Reflect.set(globalThis, 'Translator', {
      async availability() {
        return 'available';
      },
      async create() {
        return {
          async translate(input: string) {
            return `NATIF:${input}`;
          },
        };
      },
    });

    const partials: string[] = [];
    const nativeRes = await translateInBrowser(
      'Chapter 1',
      'First paragraph.\n\nSecond paragraph.',
      {
        onPartial: (partial) => partials.push(partial.translatedText),
      }
    );
    assert.deepEqual(nativeRes, {
      translatedTitle: 'NATIF:Chapter 1',
      translatedText: 'NATIF:First paragraph.\n\nNATIF:Second paragraph.',
    });
    assert.ok(partials.length >= 1, 'Expected progressive partial results during native translation');
    assert.equal(workerCreatedCount, 0, 'Worker should not be spawned when native Translator succeeds');

    // 2. Native Translator throws NotAllowedError -> seamless fallback to ONNX worker
    resetTranslationRuntimeForTests();
    Reflect.set(globalThis, 'Translator', {
      async availability() {
        return 'downloadable';
      },
      async create() {
        throw new DOMException('Requires user gesture', 'NotAllowedError');
      },
    });

    const fallbackRes = await translateInBrowser('Title', 'Body text');
    assert.deepEqual(fallbackRes, {
      translatedTitle: 'W:Title',
      translatedText: 'W:Body text',
    });
    assert.equal(workerCreatedCount, 1);

    // 3. After worker reports WASM backend, large multi-paragraph chapters fan out across 2 workers
    const longParaA = 'A'.repeat(1100);
    const longParaB = 'B'.repeat(1100);
    const parallelRes = await translateInBrowser('Big Chapter', `${longParaA}\n\n${longParaB}`);
    assert.equal(parallelRes.translatedTitle, 'W:Big Chapter');
    assert.equal(parallelRes.translatedText, `W:${longParaA}\n\nW:${longParaB}`);
    assert.equal(workerCreatedCount, 2, 'Expected second WASM worker for parallel chapter split');
  } finally {
    resetTranslationRuntimeForTests();
    Reflect.set(globalThis, 'Worker', originalWorker);
    if (originalTranslator !== undefined) {
      Reflect.set(globalThis, 'Translator', originalTranslator);
    } else {
      Reflect.deleteProperty(globalThis, 'Translator');
    }
  }
});
