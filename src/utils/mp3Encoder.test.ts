import test from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeSamplesToMp3,
  formatByteSizeFr,
  IncrementalMp3Builder,
  normalizeMp3SampleRate,
} from './mp3Encoder';

test('encodeSamplesToMp3 produces a non-empty valid MPEG audio stream', () => {
  const sampleRate = 24000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  }

  const mp3 = encodeSamplesToMp3(samples, sampleRate, 128);
  assert.ok(mp3.length > 1000, `Expected >1000 bytes of MP3 data, got ${mp3.length}`);

  let hasSyncWord = false;
  for (let i = 0; i < Math.min(mp3.length - 1, 512); i++) {
    if (mp3[i] === 0xff && (mp3[i + 1] & 0xe0) === 0xe0) {
      hasSyncWord = true;
      break;
    }
  }
  assert.equal(hasSyncWord, true, 'MP3 output must contain valid MPEG frame sync bytes');
});

test('IncrementalMp3Builder merges multiple chapter segments cleanly into one valid MP3', () => {
  const sampleRate = 24000;
  const seg1 = new Float32Array(sampleRate * 0.5);
  const seg2 = new Float32Array(sampleRate * 0.5);
  for (let i = 0; i < seg1.length; i++) {
    seg1[i] = 0.2 * Math.sin((2 * Math.PI * 330 * i) / sampleRate);
    seg2[i] = 0.2 * Math.sin((2 * Math.PI * 520 * i) / sampleRate);
  }

  const builder = new IncrementalMp3Builder(sampleRate, 128);
  builder.appendSamples(seg1);
  builder.appendSilence(0.25);
  builder.appendSamples(seg2);
  const mp3 = builder.finalize();

  assert.ok(mp3.length > 2000, `Expected merged MP3 > 2000 bytes, got ${mp3.length}`);
  assert.equal(mp3[0], 0xff);
});

test('IncrementalMp3Builder safely resamples non-standard Hi-Res hardware sample rates (96 kHz)', () => {
  assert.equal(normalizeMp3SampleRate(96000), 44100);
  assert.equal(normalizeMp3SampleRate(48000), 48000);
  assert.equal(normalizeMp3SampleRate(24000), 24000);

  const hiResRate = 96000;
  const samples = new Float32Array(hiResRate * 0.25);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.2 * Math.sin((2 * Math.PI * 440 * i) / hiResRate);
  }

  const mp3 = encodeSamplesToMp3(samples, hiResRate, 128);
  assert.ok(mp3.length > 500, `Expected valid resampled MP3, got ${mp3.length} bytes`);
  assert.equal(formatByteSizeFr(153600), '150 Ko');
  assert.equal(formatByteSizeFr(2 * 1024 * 1024), '2,0 Mo');
});
