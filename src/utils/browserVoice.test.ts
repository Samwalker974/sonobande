import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disposeVoiceWorker,
  synthesizeInBrowser,
  type VoiceWorkerRequest,
  type VoiceWorkerResponse,
} from './browserVoice';

test('synthesizeInBrowser returns audio, forwards worker errors, and supports cancellation', async () => {
  const messages: VoiceWorkerRequest[] = [];
  const fakeWorker = {
    onmessage: null as ((event: MessageEvent<VoiceWorkerResponse>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage(message: VoiceWorkerRequest) {
      messages.push(message);
      if (message.type !== 'synthesize') return;

      queueMicrotask(() => {
        if (message.text === 'broken') {
          fakeWorker.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'error', id: message.id, message: 'Échec Piper.' },
            })
          );
        } else if (message.text === 'phrase') {
          fakeWorker.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'result', id: message.id, audio: new Blob(['wav']) },
            })
          );
        }
      });
    },
    terminate() {},
  };
  const originalWorker = globalThis.Worker;
  Reflect.set(globalThis, 'Worker', function WorkerStub() {
    return fakeWorker;
  });

  try {
    const audio = await synthesizeInBrowser('phrase', 'fr_FR-siwis-medium');
    assert.equal(await audio.text(), 'wav');

    await assert.rejects(synthesizeInBrowser('broken', 'fr_FR-siwis-medium'), {
      message: 'Échec Piper.',
    });

    const controller = new AbortController();
    const cancelledSynthesis = synthesizeInBrowser(
      'cancelled phrase',
      'fr_FR-siwis-medium',
      controller.signal
    );
    controller.abort();
    await assert.rejects(cancelledSynthesis, { name: 'AbortError' });

    assert.deepEqual(
      messages.map((message) => message.type),
      ['synthesize', 'synthesize', 'synthesize', 'cancel']
    );
  } finally {
    disposeVoiceWorker();
    Reflect.set(globalThis, 'Worker', originalWorker);
  }
});

test('synthesizeInBrowser recycles the voice worker periodically to avoid WASM memory growth', async () => {
  disposeVoiceWorker();
  let createdWorkers = 0;
  let terminatedWorkers = 0;

  const originalWorker = globalThis.Worker;
  Reflect.set(globalThis, 'Worker', function WorkerStub() {
    createdWorkers++;
    const worker = {
      onmessage: null as ((event: MessageEvent<VoiceWorkerResponse>) => void) | null,
      onerror: null as ((event: ErrorEvent) => void) | null,
      onmessageerror: null as (() => void) | null,
      postMessage(message: VoiceWorkerRequest) {
        if (message.type !== 'synthesize') return;
        queueMicrotask(() => {
          worker.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'result', id: message.id, audio: new Blob(['ok']) },
            })
          );
        });
      },
      terminate() {
        terminatedWorkers++;
      },
    };
    return worker;
  });

  try {
    for (let i = 0; i < 17; i++) {
      const blob = await synthesizeInBrowser(`phrase ${i}`, 'fr_FR-siwis-medium');
      assert.equal(await blob.text(), 'ok');
    }
    assert.ok(
      terminatedWorkers >= 1 && createdWorkers >= 2,
      `Expected worker recycle after batch, got created=${createdWorkers}, terminated=${terminatedWorkers}`
    );
  } finally {
    disposeVoiceWorker();
    Reflect.set(globalThis, 'Worker', originalWorker);
  }
});
