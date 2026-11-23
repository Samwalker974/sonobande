import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTextForSpeech, stripParasiticCharacters } from './speechSanitizer.ts';

test('stripParasiticCharacters removes NMT tokens, markdown, footnotes, bullets, and divider lines', () => {
  const dirty =
    '### Chapitre 1\n\n' +
    '>>fr<< **Le gardien** monta l’escalier[12] avec une _lanterne_¹ et un carnet`.\n' +
    '***\n' +
    '• Il regarda la mer~~~ ❖ <pad></s>\n' +
    '---\n' +
    'Une extra-\nordinaire lumière éclairait le port...!!!';

  const cleaned = stripParasiticCharacters(dirty);

  assert.ok(!cleaned.includes('###'));
  assert.ok(!cleaned.includes('>>fr<<'));
  assert.ok(!cleaned.includes('**'));
  assert.ok(!cleaned.includes('_'));
  assert.ok(!cleaned.includes('[12]'));
  assert.ok(!cleaned.includes('¹'));
  assert.ok(!cleaned.includes('***'));
  assert.ok(!cleaned.includes('---'));
  assert.ok(!cleaned.includes('•'));
  assert.ok(!cleaned.includes('❖'));
  assert.ok(!cleaned.includes('<pad>'));
  assert.ok(!cleaned.includes('</s>'));
  assert.ok(cleaned.includes('Le gardien monta l’escalier avec une lanterne'));
  assert.ok(cleaned.includes('extraordinaire lumière'));
  assert.ok(cleaned.includes('port…!'));
});

test('stripParasiticCharacters repairs mojibake, PDF ligatures, numeric HTML entities, and removes non-Latin hallucinations', () => {
  const dirty =
    'Lâ€™Ã©tÃ© arrivait &#8212; une \uFB01ne brume \uFB02ottait【Note】 sur le quai \uFFFD 日本語 ★ ===';

  const cleaned = stripParasiticCharacters(dirty);

  assert.ok(cleaned.includes('L’été arrivait'));
  assert.ok(cleaned.includes('fine brume flottait'));
  assert.ok(!cleaned.includes('&#8212;'));
  assert.ok(!cleaned.includes('【'));
  assert.ok(!cleaned.includes('】'));
  assert.ok(!cleaned.includes('\uFFFD'));
  assert.ok(!cleaned.includes('日本語'));
  assert.ok(!cleaned.includes('★'));
  assert.ok(!cleaned.includes('==='));
});

test('sanitizeTextForSpeech removes quotes, brackets, URLs, and symbols while preserving natural French speech', () => {
  const input =
    '— « Bonjour ! » dit-il (d’une voix calme) à 20 °C & 50 % d’humidité — voir https://example.com/test pour le trajet jour/nuit.';

  const spoken = sanitizeTextForSpeech(input);

  assert.ok(!/[«»"()—–/*#[\]{}_~<>]/.test(spoken));
  assert.ok(!spoken.includes('https'));
  assert.ok(spoken.includes('Bonjour!'));
  assert.ok(spoken.includes('dit-il'));
  assert.ok(spoken.includes('20 degrés Celsius et 50 pour cent'));
  assert.ok(spoken.includes('jour ou nuit'));
});

test('sanitizeTextForSpeech returns empty string for pure decorative noise segments', () => {
  assert.equal(sanitizeTextForSpeech('***  ---  ❖❖❖  [1]'), '');
});
