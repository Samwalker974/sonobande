import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBrowserMp3Session,
  type Mp3WorkerRequest,
  type Mp3WorkerResponse,
} from './browserMp3';

test('createBrowserMp3Session streams WAV/PCM segments to the worker, returns MP3 bytes, and supports cancellation', async () => {
  const messages: Mp3WorkerRequest[] = [];
  const transfers: Transferable[][] = [];
  const fakeWorker = {
    onmessage: null as ((event: MessageEvent<Mp3WorkerResponse>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage(message: Mp3WorkerRequest, transfer: Transferable[] = []) {
      messages.push(message);
      transfers.push(transfer);
      if (message.type === 'cancel') return;

      queueMicrotask(() => {
        if (message.type === 'finalize') {
          const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64]).buffer;
          fakeWorker.onmessage?.(
            new MessageEvent('message', {
              data: { type: 'result', requestId: message.requestId, mp3Buffer: mp3 },
            })
          );
          return;
        }

        if (message.type === 'append-silence' && message.seconds < 0) {
          fakeWorker.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'error',
                requestId: message.requestId,
                message: 'Durée de silence invalide.',
              },
            })
          );
          return;
        }

        if (message.type === 'append-wav' && message.wavBuffer.byteLength === 4) {
          return;
        }

        fakeWorker.onmessage?.(
          new MessageEvent('message', {
            data: { type: 'ack', requestId: message.requestId },
          })
        );
      });
    },
    terminate() {},
  };

  const originalWorker = globalThis.Worker;
  Reflect.set(globalThis, 'Worker', function WorkerStub() {
    return fakeWorker;
  });

  try {
    const session = await createBrowserMp3Session({ bitrateKbps: 128 });
    const sourceWav = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

    await session.appendWav(sourceWav, {
      pauseOffsets: [120],
      speed: 1.1,
      pitchSemitones: 0,
      pauseDurationSeconds: 0.3,
      includeEndPause: true,
    });
    // Source buffer stays intact (worker receives a transferred clone)
    assert.equal(sourceWav.byteLength, 8);

    await session.appendSilence(0.7);
    const mp3 = await session.finalize();
    assert.deepEqual(Array.from(mp3), [0xff, 0xfb, 0x90, 0x64]);

    const failingSession = await createBrowserMp3Session();
    await assert.rejects(failingSession.appendSilence(-1), {
      message: 'Durée de silence invalide.',
    });
    failingSession.cancel();

    const controller = new AbortController();
    const cancelledSession = await createBrowserMp3Session({ signal: controller.signal });
    const pendingAppend = cancelledSession.appendWav(new ArrayBuffer(4), {
      pauseOffsets: [],
      speed: 1,
      pitchSemitones: 0,
      pauseDurationSeconds: 0,
      includeEndPause: false,
    });
    controller.abort();
    await assert.rejects(pendingAppend, { name: 'AbortError' });

    assert.deepEqual(
      messages.map((m) => m.type),
      [
        'start',
        'append-wav',
        'append-silence',
        'finalize',
        'start',
        'append-silence',
        'cancel',
        'start',
        'append-wav',
        'cancel',
      ]
    );
    assert.equal(transfers[1]?.length, 1);
  } finally {
    Reflect.set(globalThis, 'Worker', originalWorker);
  }
});
