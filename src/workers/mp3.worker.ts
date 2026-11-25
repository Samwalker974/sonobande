import {
  enhanceVoiceHdFluid,
  insertSilenceAtOffsets,
  parseWavBuffer,
  processAudioSpeedPitch,
} from '../utils/audioDsp';
import { IncrementalMp3Builder } from '../utils/mp3Encoder';
import type { Mp3WorkerRequest, Mp3WorkerResponse } from '../utils/browserMp3';

interface ActiveMp3Session {
  bitrateKbps: number;
  builder: IncrementalMp3Builder | null;
}

const sessions = new Map<number, ActiveMp3Session>();
let workQueue: Promise<void> = Promise.resolve();
const workerScope = self as unknown as {
  postMessage: (message: Mp3WorkerResponse, transfer?: Transferable[]) => void;
};

function sendMessage(message: Mp3WorkerResponse, transfer: Transferable[] = []): void {
  if (transfer.length > 0) {
    workerScope.postMessage(message, transfer);
  } else {
    workerScope.postMessage(message);
  }
}

function getOrCreateBuilder(session: ActiveMp3Session, sampleRate: number): IncrementalMp3Builder {
  if (!session.builder) {
    session.builder = new IncrementalMp3Builder(sampleRate, session.bitrateKbps);
  }
  return session.builder;
}

function appendShapedSamples(
  session: ActiveMp3Session,
  samples: Float32Array,
  sampleRate: number,
  pauseOffsets: number[],
  speed: number,
  pitchSemitones: number,
  pauseDurationSeconds: number,
  includeEndPause: boolean,
  hdVoiceEnhanced = false
): void {
  const builder = getOrCreateBuilder(session, sampleRate);
  const shaped = processAudioSpeedPitch(samples, sampleRate, speed, pitchSemitones);
  const enhanced = hdVoiceEnhanced ? enhanceVoiceHdFluid(shaped, sampleRate) : shaped;
  const shapedWithPauses = insertSilenceAtOffsets(
    enhanced,
    samples.length,
    pauseOffsets,
    sampleRate,
    pauseDurationSeconds,
    includeEndPause
  );
  builder.appendSamples(shapedWithPauses, sampleRate);
}

function handleRequest(request: Mp3WorkerRequest): void {
  if (request.type === 'start') {
    sessions.set(request.sessionId, {
      bitrateKbps: request.bitrateKbps,
      builder: null,
    });
    sendMessage({ type: 'ack', requestId: request.requestId });
    return;
  }

  if (request.type === 'cancel') {
    sessions.delete(request.sessionId);
    return;
  }

  const session = sessions.get(request.sessionId);
  if (!session) {
    sendMessage({
      type: 'error',
      requestId: request.requestId,
      message: 'Session d’encodage MP3 introuvable ou annulée.',
    });
    return;
  }

  if (request.type === 'append-wav') {
    const wav = parseWavBuffer(request.wavBuffer);
    appendShapedSamples(
      session,
      wav.samples,
      wav.sampleRate,
      request.pauseOffsets,
      request.speed,
      request.pitchSemitones,
      request.pauseDurationSeconds,
      request.includeEndPause,
      Boolean(request.hdVoiceEnhanced)
    );
    sendMessage({ type: 'ack', requestId: request.requestId });
    return;
  }

  if (request.type === 'append-pcm') {
    const samples = new Float32Array(request.pcmBuffer);
    appendShapedSamples(
      session,
      samples,
      request.sampleRate,
      request.pauseOffsets,
      request.speed,
      request.pitchSemitones,
      request.pauseDurationSeconds,
      request.includeEndPause,
      Boolean(request.hdVoiceEnhanced)
    );
    sendMessage({ type: 'ack', requestId: request.requestId });
    return;
  }

  if (request.type === 'append-silence') {
    session.builder?.appendSilence(request.seconds);
    sendMessage({ type: 'ack', requestId: request.requestId });
    return;
  }

  if (request.type === 'finalize') {
    sessions.delete(request.sessionId);
    if (!session.builder) {
      sendMessage({
        type: 'error',
        requestId: request.requestId,
        message: 'Aucun audio généré pour cet export.',
      });
      return;
    }

    const mp3Bytes = session.builder.finalize();
    const mp3Buffer =
      mp3Bytes.byteOffset === 0 && mp3Bytes.byteLength === mp3Bytes.buffer.byteLength
        ? (mp3Bytes.buffer as ArrayBuffer)
        : mp3Bytes.slice().buffer;
    sendMessage({ type: 'result', requestId: request.requestId, mp3Buffer }, [mp3Buffer]);
  }
}

self.addEventListener('message', (event: MessageEvent<Mp3WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    sessions.delete(request.sessionId);
    return;
  }

  workQueue = workQueue.then(() => {
    try {
      handleRequest(request);
    } catch (error) {
      if (request.type === 'finalize') {
        sessions.delete(request.sessionId);
      }
      sendMessage({
        type: 'error',
        requestId: request.requestId,
        message:
          error instanceof Error
            ? error.message
            : 'Impossible d’encoder cet audio en MP3 dans le navigateur.',
      });
    }
  });
});
