import { Mp3Encoder } from '@breezystack/lamejs';

const VALID_MP3_SAMPLE_RATES = new Set([
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
]);

/**
 * Resamples mono Float32 PCM cleanly using linear interpolation when the browser AudioContext
 * operates at an unsupported MP3 sample rate (such as 96 kHz or 192 kHz on Hi-Res audio hardware).
 */
export function resampleMonoPcm(
  samples: Float32Array,
  fromRate: number,
  toRate: number
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const targetLength = Math.max(1, Math.round(samples.length / ratio));
  const output = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const idx1 = Math.min(idx0 + 1, samples.length - 1);
    const frac = srcPos - idx0;
    output[i] = samples[idx0] * (1 - frac) + samples[idx1] * frac;
  }

  return output;
}

export function normalizeMp3SampleRate(sampleRate: number): number {
  if (VALID_MP3_SAMPLE_RATES.has(sampleRate)) return sampleRate;
  return sampleRate > 48000 ? 44100 : 24000;
}

/**
 * Incremental MP3 stream builder: encodes long chapters or multi-hour books
 * segment-by-segment into compact MP3 chunks without holding huge uncompressed PCM buffers in RAM.
 */
export class IncrementalMp3Builder {
  private encoder: Mp3Encoder;
  private inputSampleRate: number;
  private targetSampleRate: number;
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;

  constructor(sampleRate: number, bitrateKbps = 128) {
    this.inputSampleRate = sampleRate;
    this.targetSampleRate = normalizeMp3SampleRate(sampleRate);
    this.encoder = new Mp3Encoder(1, this.targetSampleRate, bitrateKbps);
  }

  appendSamples(samples: Float32Array, sourceSampleRate = this.inputSampleRate): void {
    const readySamples =
      sourceSampleRate !== this.targetSampleRate
        ? resampleMonoPcm(samples, sourceSampleRate, this.targetSampleRate)
        : samples;

    const int16 = new Int16Array(readySamples.length);
    for (let i = 0; i < readySamples.length; i++) {
      const s = Math.max(-1, Math.min(1, readySamples[i]));
      int16[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
    }

    const blockSize = 1152;
    for (let i = 0; i < int16.length; i += blockSize) {
      const slice = int16.subarray(i, Math.min(i + blockSize, int16.length));
      const mp3Buf = this.encoder.encodeBuffer(slice);
      if (mp3Buf.length > 0) {
        this.chunks.push(mp3Buf);
        this.totalBytes += mp3Buf.length;
      }
    }
  }

  /**
   * Appends a short clean silence gap (e.g., between chapters) in seconds.
   */
  appendSilence(seconds: number): void {
    const count = Math.max(0, Math.round(seconds * this.targetSampleRate));
    if (count === 0) return;
    this.appendSamples(new Float32Array(count), this.targetSampleRate);
  }

  finalize(): Uint8Array {
    const flushBuf = this.encoder.flush();
    if (flushBuf.length > 0) {
      this.chunks.push(flushBuf);
      this.totalBytes += flushBuf.length;
    }

    const result = new Uint8Array(this.totalBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

/**
 * Encodes a single Float32 PCM buffer into a valid MP3 Uint8Array.
 */
export function encodeSamplesToMp3(
  samples: Float32Array,
  sampleRate: number,
  bitrateKbps = 128
): Uint8Array {
  const builder = new IncrementalMp3Builder(sampleRate, bitrateKbps);
  builder.appendSamples(samples, sampleRate);
  return builder.finalize();
}

/**
 * Formats byte size cleanly in French (e.g., "142 Ko", "4,8 Mo").
 */
export function formatByteSizeFr(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Creates a reusable in-memory Blob URL for an MP3 file and attempts an immediate download.
 * Returns the Blob URL so the UI can also render a direct native <a download> button
 * (which works reliably even in sandboxed iframes or after async user-gesture expiration).
 */
export function createMp3ObjectUrl(mp3Bytes: Uint8Array): string {
  const buffer =
    mp3Bytes.byteOffset === 0 && mp3Bytes.byteLength === mp3Bytes.buffer.byteLength
      ? (mp3Bytes.buffer as ArrayBuffer)
      : mp3Bytes.slice().buffer;
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  return URL.createObjectURL(blob);
}

export function triggerDownloadFromObjectUrl(objectUrl: string, filename: string): void {
  const safeName = filename.endsWith('.mp3') ? filename : `${filename}.mp3`;
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = safeName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
