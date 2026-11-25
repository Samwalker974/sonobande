import assert from 'node:assert/strict';
import test from 'node:test';
import {
  disposeVoiceWorker,
  synthesizeInBrowser,
  synthesizePcmInBrowser,
  type VoiceWorkerRequest,
  type VoiceWorkerResponse,
} from './browserVoice';

test('synthesizeInBrowser returns audio, forwards worker errors, and supports cancellation', async () => {
  disposeVoiceWorker();
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

test('synthesizePcmInBrowser streams multi-phrase PCM without WAV round-trips and reuses the persistent worker', async () => {
  disposeVoiceWorker();
  let createdWorkers = 0;
  let terminatedWorkers = 0;
  const progressEvents: Array<[number, number]> = [];

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
          const phraseCount = message.phrases?.length ?? 1;
          if (phraseCount > 1) {
            worker.onmessage?.(
              new MessageEvent('message', {
                data: { type: 'progress', id: message.id, completed: 1, total: phraseCount },
              })
            );
          }
          const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
          worker.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'result',
                id: message.id,
                pcmBuffer: samples.buffer,
                sampleRate: 22050,
                pauseOffsets: phraseCount > 1 ? [2, 4] : [],
              },
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
    const multi = await synthesizePcmInBrowser(
      [
        { text: 'Première phrase.', pauseAfter: true },
        { text: 'Deuxième phrase.', pauseAfter: true },
      ],
      'fr_FR-siwis-medium',
      {
        onProgress: (completed, total) => progressEvents.push([completed, total]),
      }
    );
    assert.equal(multi.sampleRate, 22050);
    assert.equal(multi.samples.length, 4);
    assert.deepEqual(multi.pauseOffsets, [2, 4]);
    assert.deepEqual(progressEvents, [[1, 2]]);

    // Persistent worker stays alive across many syntheses so the cached ONNX session is reused
    for (let i = 0; i < 25; i++) {
      const pcm = await synthesizePcmInBrowser(`phrase ${i}`, 'fr_FR-siwis-medium');
      assert.equal(pcm.sampleRate, 22050);
      assert.equal(pcm.samples.length, 4);
    }
    assert.equal(createdWorkers, 1, 'Expected a single persistent worker to be reused');
    assert.equal(terminatedWorkers, 0, 'Expected persistent worker not to be recycled');
  } finally {
    disposeVoiceWorker();
    Reflect.set(globalThis, 'Worker', originalWorker);
  }
});
