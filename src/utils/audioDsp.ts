/**
 * Pure TypeScript WAV parsing/encoding and real-time-capable DSP
 * for independent speed (WSOLA time-stretching) and pitch shifting (resampling).
 */

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

export const DEFAULT_PAUSE_DURATION_SECONDS = 0;

export function insertSilenceAtOffsets(
  samples: Float32Array,
  sourceSampleLength: number,
  pauseOffsets: readonly number[],
  sampleRate: number,
  durationSeconds: number,
  includeEndOffset = false
): Float32Array {
  if (
    samples.length === 0 ||
    sourceSampleLength <= 0 ||
    pauseOffsets.length === 0 ||
    !Number.isFinite(sampleRate) ||
    !Number.isFinite(durationSeconds)
  ) {
    return samples;
  }

  const silenceLength = Math.max(0, Math.round(sampleRate * durationSeconds));
  if (silenceLength === 0) return samples;

  const scale = samples.length / sourceSampleLength;
  const insertionPoints = [...new Set(
    pauseOffsets
      .filter((offset) => offset > 0 && (offset < sourceSampleLength || includeEndOffset))
      .map((offset) => Math.round(offset * scale))
      .filter((offset) => offset <= samples.length)
  )].sort((a, b) => a - b);
  if (insertionPoints.length === 0) return samples;

  const output = new Float32Array(samples.length + silenceLength * insertionPoints.length);
  let sourceOffset = 0;
  let outputOffset = 0;
  for (const point of insertionPoints) {
    output.set(samples.subarray(sourceOffset, point), outputOffset);
    outputOffset += point - sourceOffset + silenceLength;
    sourceOffset = point;
  }
  output.set(samples.subarray(sourceOffset), outputOffset);
  return output;
}

/**
 * Parses a mono or stereo 16-bit PCM WAV ArrayBuffer into normalized mono Float32 samples [-1, 1].
 */
export function parseWavBuffer(buffer: ArrayBuffer): DecodedWav {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) {
    throw new Error('Fichier audio WAV invalide ou incomplet.');
  }

  const riff = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  const wave = String.fromCharCode(
    view.getUint8(8),
    view.getUint8(9),
    view.getUint8(10),
    view.getUint8(11)
  );

  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('En-tête WAV non reconnu.');
  }

  let offset = 12;
  let sampleRate = 24000;
  let numChannels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const size = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (id === 'fmt ' && chunkStart + 16 <= buffer.byteLength) {
      numChannels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (id === 'data') {
      dataOffset = chunkStart;
      dataLength = Math.min(size, buffer.byteLength - chunkStart);
      break;
    }

    offset = chunkStart + size + (size % 2);
  }

  if (dataOffset < 0 || dataLength <= 0) {
    throw new Error('Données PCM introuvables dans le fichier WAV.');
  }

  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  const frameSize = bytesPerSample * numChannels;
  const totalFrames = Math.floor(dataLength / frameSize);
  const samples = new Float32Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    let sum = 0;
    const frameBase = dataOffset + i * frameSize;
    for (let ch = 0; ch < numChannels; ch++) {
      const samplePos = frameBase + ch * bytesPerSample;
      if (bitsPerSample === 16) {
        sum += view.getInt16(samplePos, true) / 32768;
      } else if (bitsPerSample === 8) {
        sum += (view.getUint8(samplePos) - 128) / 128;
      } else if (bitsPerSample === 32) {
        sum += view.getFloat32(samplePos, true);
      }
    }
    samples[i] = Math.max(-1, Math.min(1, sum / numChannels));
  }

  return { samples, sampleRate };
}

/**
 * Encodes mono Float32 samples [-1, 1] into a standard 16-bit PCM WAV ArrayBuffer.
 */
export function encodeWavBuffer(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (pos: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(44 + i * 2, int16, true);
  }

  return buffer;
}

/**
 * Linear interpolation resampling.
 * ratio > 1.0 speeds up & raises pitch (shorter output).
 * ratio < 1.0 slows down & lowers pitch (longer output).
 */
export function resampleLinear(samples: Float32Array, ratio: number): Float32Array {
  if (samples.length === 0) return new Float32Array(0);
  if (Math.abs(ratio - 1) < 1e-4) {
    return new Float32Array(samples);
  }

  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = idx < samples.length ? samples[idx] : 0;
    const s1 = idx + 1 < samples.length ? samples[idx + 1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
  }

  return out;
}

/**
 * WSOLA (Waveform Similarity Overlap-Add) time-stretching without changing pitch.
 * speedRatio > 1.0 makes audio faster/shorter; speedRatio < 1.0 makes audio slower/longer.
 */
export function timeStretchWsola(
  samples: Float32Array,
  sampleRate: number,
  speedRatio: number
): Float32Array {
  const n = samples.length;
  if (n === 0) return new Float32Array(0);
  if (Math.abs(speedRatio - 1) < 1e-3) {
    return new Float32Array(samples);
  }

  // Speech-optimized 32ms window, 50% overlap (periodic Hann sums identically to 1.0)
  const rawWin = Math.round(sampleRate * 0.032);
  const winSize = rawWin % 2 === 0 ? rawWin : rawWin + 1;
  const halfWin = winSize / 2;
  const searchRadius = Math.round(sampleRate * 0.008);

  if (n < winSize * 2) {
    return new Float32Array(samples);
  }

  // Periodic Hann window: w[i] + w[i + halfWin] === 1.0 everywhere
  const hann = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / winSize));
  }

  const targetLength = Math.max(winSize, Math.round(n / speedRatio));
  const output = new Float32Array(targetLength);

  // Copy initial half-window cleanly
  for (let i = 0; i < Math.min(halfWin, targetLength, n); i++) {
    output[i] = samples[i];
  }

  let outPos = halfWin;
  let prevAnalysisPos = 0;
  let frameIndex = 1;

  while (outPos + halfWin < targetLength) {
    const nominalInPos = Math.round(frameIndex * halfWin * speedRatio);
    if (nominalInPos + winSize >= n) {
      break;
    }

    // Natural continuation point of the previous frame
    const naturalPos = prevAnalysisPos + halfWin;

    // Search around nominalInPos for best waveform phase alignment with naturalPos
    let bestOffset = 0;
    let bestScore = -Infinity;

    if (naturalPos + halfWin < n) {
      const minDelta = Math.max(-searchRadius, -nominalInPos);
      const maxDelta = Math.min(searchRadius, n - winSize - nominalInPos);

      // Step by 2 samples for speed while keeping phase alignment tight
      for (let delta = minDelta; delta <= maxDelta; delta += 2) {
        const candPos = nominalInPos + delta;
        let dot = 0;
        let normA = 0;
        let normB = 0;

        for (let k = 0; k < halfWin; k += 2) {
          const a = samples[naturalPos + k];
          const b = samples[candPos + k];
          dot += a * b;
          normA += a * a;
          normB += b * b;
        }

        const denom = Math.sqrt(normA * normB) + 1e-8;
        const corr = dot / denom;
        if (corr > bestScore) {
          bestScore = corr;
          bestOffset = delta;
        }
      }
    }

    const chosenInPos = Math.max(0, Math.min(n - winSize, nominalInPos + bestOffset));

    // Overlap-add previous tail fade-out with current head fade-in across [outPos - halfWin, outPos)
    const overlapStart = outPos - halfWin;
    for (let i = 0; i < halfWin; i++) {
      const fadeOut = hann[halfWin + i]; // 1 -> 0
      const fadeIn = hann[i]; // 0 -> 1
      const prevSample =
        naturalPos + i < n ? samples[naturalPos + i] : output[overlapStart + i];
      const currSample = samples[chosenInPos + i];
      output[overlapStart + i] = prevSample * fadeOut + currSample * fadeIn;
    }

    // Write the un-overlapped second half provisionally (will be overlapped on next iteration)
    const tailLen = Math.min(halfWin, targetLength - outPos);
    for (let i = 0; i < tailLen; i++) {
      output[outPos + i] = samples[chosenInPos + halfWin + i];
    }

    prevAnalysisPos = chosenInPos;
    outPos += halfWin;
    frameIndex++;
  }

  // Gentle 5ms end fade-out to avoid any trailing click
  const fadeLen = Math.min(Math.round(sampleRate * 0.005), output.length);
  for (let i = 0; i < fadeLen; i++) {
    output[output.length - 1 - i] *= i / fadeLen;
  }

  return output;
}

/**
 * Applies independent speed (0.5x..2.0x) and pitch (-6..+6 semitones) to mono PCM samples.
 * Bypassed bit-identically when speed === 1.0 and pitchSemitones === 0.
 */
export function processAudioSpeedPitch(
  samples: Float32Array,
  sampleRate: number,
  speed: number,
  pitchSemitones: number
): Float32Array {
  const clampedSpeed = Math.max(0.5, Math.min(2.0, speed));
  const clampedPitch = Math.max(-6, Math.min(6, pitchSemitones));

  if (Math.abs(clampedSpeed - 1.0) < 1e-3 && Math.abs(clampedPitch) < 1e-3) {
    return new Float32Array(samples);
  }

  const pitchFactor = Math.pow(2, clampedPitch / 12);
  // Step 1: Time-stretch by speed / pitchFactor so after resampling by pitchFactor:
  // net speed = (speed / pitchFactor) * pitchFactor = speed
  // net pitch = pitchFactor
  const stretchRatio = clampedSpeed / pitchFactor;

  const stretched =
    Math.abs(stretchRatio - 1.0) < 1e-3
      ? samples
      : timeStretchWsola(samples, sampleRate, stretchRatio);

  const resampled =
    Math.abs(pitchFactor - 1.0) < 1e-3
      ? stretched
      : resampleLinear(stretched, pitchFactor);

  // Soft-clip safety bound [-1, 1]
  for (let i = 0; i < resampled.length; i++) {
    if (!Number.isFinite(resampled[i])) {
      resampled[i] = 0;
    } else if (resampled[i] > 1) {
      resampled[i] = 1;
    } else if (resampled[i] < -1) {
      resampled[i] = -1;
    }
  }

  return resampled;
}

/**
 * Deterministic warm analog demo tape audio generator (24kHz mono WAV)
 * for initial pre-seeded calibration cassettes in the library.
 */
export function generateDemoTapeWav(
  variant: 'chime' | 'lofi' | 'reference',
  sampleRate = 24000
): ArrayBuffer {
  const durationSec = variant === 'reference' ? 4.5 : variant === 'chime' ? 5.5 : 6.0;
  const totalSamples = Math.round(sampleRate * durationSec);
  const samples = new Float32Array(totalSamples);

  const notes =
    variant === 'chime'
      ? [
          { freq: 329.63, start: 0.1, dur: 1.4 }, // E4
          { freq: 392.0, start: 0.7, dur: 1.5 }, // G4
          { freq: 493.88, start: 1.4, dur: 1.6 }, // B4
          { freq: 587.33, start: 2.2, dur: 1.8 }, // D5
          { freq: 493.88, start: 3.3, dur: 1.8 }, // B4
        ]
      : variant === 'lofi'
        ? [
            { freq: 261.63, start: 0.1, dur: 1.8 }, // C4
            { freq: 329.63, start: 0.15, dur: 1.8 }, // E4
            { freq: 392.0, start: 0.2, dur: 1.8 }, // G4
            { freq: 293.66, start: 2.0, dur: 1.8 }, // D4
            { freq: 349.23, start: 2.05, dur: 1.8 }, // F4
            { freq: 440.0, start: 2.1, dur: 1.8 }, // A4
            { freq: 261.63, start: 3.9, dur: 1.9 }, // C4
            { freq: 329.63, start: 3.95, dur: 1.9 }, // E4
            { freq: 493.88, start: 4.0, dur: 1.9 }, // B4
          ]
        : [
            { freq: 440.0, start: 0.15, dur: 1.2 }, // A4
            { freq: 554.37, start: 1.45, dur: 1.2 }, // C#5
            { freq: 659.25, start: 2.75, dur: 1.5 }, // E5
          ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let value = 0;

    for (const note of notes) {
      if (t >= note.start && t <= note.start + note.dur) {
        const localT = t - note.start;
        const attack = Math.min(1, localT / 0.045);
        const release = Math.min(1, (note.dur - localT) / 0.25);
        const decay = Math.exp(-localT * 1.15);
        const env = attack * release * decay;
        // Warm analog Rhodes-like harmonic series
        const fundamental = Math.sin(2 * Math.PI * note.freq * localT);
        const second = 0.22 * Math.sin(2 * Math.PI * note.freq * 2 * localT);
        const third = 0.07 * Math.sin(2 * Math.PI * note.freq * 3 * localT);
        value += (fundamental + second + third) * env * 0.26;
      }
    }

    // Subtle deterministic warm tape flutter & low-level hiss
    const softClip = Math.tanh(value * 1.15);
    samples[i] = softClip;
  }

  return encodeWavBuffer(samples, sampleRate);
}
