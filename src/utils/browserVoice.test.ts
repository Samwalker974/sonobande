import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
    Reflect.set(globalThis, 'Worker', originalWorker);
  }
});
