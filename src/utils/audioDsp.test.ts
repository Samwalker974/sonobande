import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeWavBuffer,
  generateDemoTapeWav,
  insertSilenceAtOffsets,
  parseWavBuffer,
  processAudioSpeedPitch,
} from './audioDsp';

test('insertSilenceAtOffsets adds pauses at punctuation positions', () => {
  const samples = new Float32Array([0.25, -0.5, 0.75, 0.125]);
  const output = insertSilenceAtOffsets(samples, 4, [2], 4, 0.5);

  assert.deepEqual([...output], [0.25, -0.5, 0, 0, 0.75, 0.125]);
  assert.equal(
    insertSilenceAtOffsets(samples, 4, [4], 4, 0.5),
    samples,
    'A terminal punctuation mark should not add trailing silence by default'
  );
  assert.deepEqual(
    [...insertSilenceAtOffsets(samples, 4, [4], 4, 0.5, true)],
    [0.25, -0.5, 0.75, 0.125, 0, 0]
  );

  assert.deepEqual(
    [...insertSilenceAtOffsets(new Float32Array([1, 2, 3, 4, 5, 6]), 3, [1], 4, 0.5)],
    [1, 2, 0, 0, 3, 4, 5, 6]
  );
});

function generateSine(freqHz: number, durationSec: number, sampleRate = 24000): Float32Array {
  const len = Math.round(durationSec * sampleRate);
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    buf[i] = 0.6 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return buf;
}

function estimateFrequencyZeroCrossings(samples: Float32Array, sampleRate: number): number {
  // Ignore first/last 10% edges
  const start = Math.floor(samples.length * 0.1);
  const end = Math.floor(samples.length * 0.9);
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) {
      crossings++;
    }
  }
  const measuredSeconds = (end - start) / sampleRate;
  return crossings / measuredSeconds;
}

test('WAV encode and parse round-trip preserves sample rate and waveform', () => {
  const sampleRate = 24000;
  const sine = generateSine(440, 0.5, sampleRate);
  const wav = encodeWavBuffer(sine, sampleRate);
  const decoded = parseWavBuffer(wav);

  assert.equal(decoded.sampleRate, sampleRate);
  assert.equal(decoded.samples.length, sine.length);

  let maxDiff = 0;
  for (let i = 0; i < sine.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(sine[i] - decoded.samples[i]));
  }
  assert.ok(maxDiff < 0.001, `Expected round-trip diff < 0.001, got ${maxDiff}`);
});

test('processAudioSpeedPitch bypasses identically at 1.0x speed and 0 semitones', () => {
  const sine = generateSine(330, 0.5, 24000);
  const out = processAudioSpeedPitch(sine, 24000, 1.0, 0);
  assert.equal(out.length, sine.length);
  for (let i = 0; i < sine.length; i++) {
    assert.equal(out[i], sine[i]);
  }
});

test('speed change scales duration while preserving pitch', () => {
  const sampleRate = 24000;
  const sine = generateSine(440, 1.0, sampleRate);

  const faster = processAudioSpeedPitch(sine, sampleRate, 1.5, 0);
  const expectedFasterLen = Math.round(sine.length / 1.5);
  assert.ok(
    Math.abs(faster.length - expectedFasterLen) / expectedFasterLen < 0.06,
    `Expected ~${expectedFasterLen} samples, got ${faster.length}`
  );
  const fasterFreq = estimateFrequencyZeroCrossings(faster, sampleRate);
  assert.ok(
    Math.abs(fasterFreq - 440) < 25,
    `Expected pitch ~440Hz after speed change, got ${fasterFreq.toFixed(1)}Hz`
  );

  const slower = processAudioSpeedPitch(sine, sampleRate, 0.75, 0);
  const expectedSlowerLen = Math.round(sine.length / 0.75);
  assert.ok(
    Math.abs(slower.length - expectedSlowerLen) / expectedSlowerLen < 0.06,
    `Expected ~${expectedSlowerLen} samples, got ${slower.length}`
  );
});

test('pitch shift changes frequency while preserving duration', () => {
  const sampleRate = 24000;
  const sine = generateSine(440, 1.0, sampleRate);

  // +4 semitones => 440 * 2^(4/12) ~= 554.37 Hz
  const higher = processAudioSpeedPitch(sine, sampleRate, 1.0, 4);
  assert.ok(
    Math.abs(higher.length - sine.length) / sine.length < 0.08,
    `Expected duration preserved (~${sine.length}), got ${higher.length}`
  );
  const freq = estimateFrequencyZeroCrossings(higher, sampleRate);
  assert.ok(
    Math.abs(freq - 554.37) < 35,
    `Expected ~554Hz at +4 semitones, got ${freq.toFixed(1)}Hz`
  );

  for (let i = 0; i < higher.length; i++) {
    assert.ok(Number.isFinite(higher[i]) && higher[i] >= -1 && higher[i] <= 1);
  }
});

test('demo tape WAV generator outputs valid playable buffers for all variants', () => {
  for (const variant of ['chime', 'lofi', 'reference'] as const) {
    const wav = generateDemoTapeWav(variant);
    const decoded = parseWavBuffer(wav);
    assert.equal(decoded.sampleRate, 24000);
    assert.ok(decoded.samples.length > 24000 * 3);
  }
});
