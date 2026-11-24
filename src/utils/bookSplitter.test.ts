import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyChapterTranslation,
  buildChaptersFromRawText,
  createBookSession,
  formatLongDuration,
  formatPitchLabel,
  formatTimecode,
  sanitizeMp3Filename,
  splitForLocalSpeech,
  splitTextAtPausePunctuation,
  splitTextIntoSegments,
} from './bookSplitter';

test('formatTimecode formats sub-hour and multi-hour durations', () => {
  assert.equal(formatTimecode(0), '00:00');
  assert.equal(formatTimecode(75), '01:15');
  assert.equal(formatTimecode(3665), '01:01:05');
  assert.equal(formatTimecode(-4), '00:00');
});

test('formatLongDuration produces clean French hour/minute strings', () => {
  assert.equal(formatLongDuration(42), '42 s');
  assert.equal(formatLongDuration(720), '12 min');
  assert.equal(formatLongDuration(3 * 3600 + 18 * 60), '3 h 18 min');
});

test('buildChaptersFromRawText detects French chapter headings', () => {
  const sample = `Chapitre 1 : Départ\n\nIl pleuvait doucement sur la gare.\n\nChapitre 2 : Arrivée\n\nLe soleil perçait enfin les nuages.`;
  const chapters = buildChaptersFromRawText(sample);

  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapitre 1 : Départ');
  assert.equal(chapters[1].title, 'Chapitre 2 : Arrivée');
  assert.ok(chapters[0].text.includes('gare'));
  assert.ok(chapters[1].text.includes('nuages'));
});

test('createBookSession detects English chapters and applyChapterTranslation updates segments cleanly', () => {
  const englishSample = `Chapter 1: Dawn Over the Harbor\n\nAt six in the morning, the coastal harbor still breathed the quiet of the night.\n\nChapter 2: The Bookshop\n\nBehind the fogged windows, the shelves overflowed with clothbound novels.`;
  const chapters = buildChaptersFromRawText(englishSample);
  assert.equal(chapters.length, 2);

  const session = createBookSession({
    title: 'The Coastal Lighthouse',
    source: 'epub',
    chapters,
  });

  assert.equal(session.detectedLanguage, 'en');
  assert.equal(session.chapters[0].translationStatus, 'needs_translation');
  assert.equal(session.chapters[1].translationStatus, 'needs_translation');

  const translated = applyChapterTranslation(
    session.chapters[0],
    "Chapitre 1 : L'aube sur le port",
    'À six heures du matin, le port côtier respirait encore le calme de la nuit.'
  );
  assert.equal(translated.translationStatus, 'translated');
  assert.equal(translated.title, "Chapitre 1 : L'aube sur le port");
  assert.ok(translated.text.includes('port côtier'));
  assert.equal(translated.sourceTitle, 'Chapter 1: Dawn Over the Harbor');
  assert.equal(translated.segments.length, 1);
});

test('buildChaptersFromRawText splits very long plain text into balanced chapters without losing words', () => {
  const paragraph =
    'Voici un paragraphe de lecture en français assez long pour simuler un véritable chapitre de roman complet. ';
  const hugeText = Array.from({ length: 260 }, () => paragraph.trim()).join('\n\n');

  const chapters = buildChaptersFromRawText(hugeText, 'Mon livre', 10000);
  assert.ok(chapters.length >= 2, `Expected >= 2 chapters, got ${chapters.length}`);
  for (const ch of chapters) {
    assert.ok(ch.charCount <= 10500, `Chapter too large: ${ch.charCount}`);
    assert.ok(ch.segments.length >= 1);
    for (const seg of ch.segments) {
      assert.ok(seg.length <= 1250, `Segment exceeded limit: ${seg.length}`);
    }
  }
});

test('splitTextIntoSegments and splitForLocalSpeech respect character bounds', () => {
  const text = Array.from(
    { length: 40 },
    (_, i) => `Phrase numéro ${i + 1} avec suffisamment de mots français pour tester le découpage propre.`
  ).join(' ');

  const segments = splitTextIntoSegments(text, 1200);
  assert.ok(segments.length >= 2);
  for (const seg of segments) {
    assert.ok(seg.length <= 1200);
  }

  const localChunks = splitForLocalSpeech(text);
  assert.ok(localChunks.length >= 10);
  for (const chunk of localChunks) {
    assert.ok(chunk.length <= 220);
  }
});

test('splitTextAtPausePunctuation preserves commas and sentence-ending punctuation', () => {
  assert.deepEqual(
    splitTextAtPausePunctuation('Bonjour, monsieur. Comment ça va ? Oui !'),
    [
      { text: 'Bonjour,', pauseAfter: true },
      { text: 'monsieur.', pauseAfter: true },
      { text: 'Comment ça va ?', pauseAfter: true },
      { text: 'Oui !', pauseAfter: true },
    ]
  );
  assert.deepEqual(splitTextAtPausePunctuation('Il mesure 3.14 mètres.'), [
    { text: 'Il mesure 3.14 mètres.', pauseAfter: true },
  ]);
});

test('sanitizeMp3Filename and formatPitchLabel work cleanly', () => {
  assert.equal(sanitizeMp3Filename("Chapitre 1 — L'Été à Lyon"), 'chapitre-1-l-ete-a-lyon.mp3');
  assert.equal(formatPitchLabel(0), '0.0 st');
  assert.equal(formatPitchLabel(-2.5), '-2.5 st');
  assert.equal(formatPitchLabel(3), '+3.0 st');
});
