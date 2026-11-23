import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChaptersFromRawText, createBookSession } from './bookSplitter';
import {
  buildReadingPosition,
  createSavedBookRecord,
  formatStorageSizeFr,
  sanitizeSessionForTextStorage,
} from './bookStorage';

test('formatStorageSizeFr formats bytes, Ko, Mo, and Go cleanly in French', () => {
  assert.equal(formatStorageSizeFr(512), '512 o');
  assert.equal(formatStorageSizeFr(2048), '2,0 Ko');
  assert.equal(formatStorageSizeFr(45 * 1024), '45 Ko');
  assert.equal(formatStorageSizeFr(3.5 * 1024 * 1024), '3,5 Mo');
  assert.equal(formatStorageSizeFr(2.4 * 1024 * 1024 * 1024), '2,4 Go');
});

test('createSavedBookRecord stores text only, normalizes translating status, and builds exact stop bookmark', () => {
  const raw =
    'Chapitre 1 : Le départ\n\nLe navire quitte le quai dans le brouillard.\n\n' +
    'Chapitre 2 : La traversée\n\nLes vagues soulèvent la proue sous un ciel clair.';
  const chapters = buildChaptersFromRawText(raw, 'Voyage en mer');
  chapters[1].translationStatus = 'translating';

  const session = createBookSession({
    title: 'Voyage en mer',
    source: 'epub',
    fileName: 'voyage.epub',
    chapters,
    detectedLanguage: 'fr',
  });

  const record = createSavedBookRecord({
    session,
    bookmarks: [],
    chapterIndex: 1,
    segmentIndex: 0,
  });

  assert.equal(record.id, session.id);
  assert.equal(record.session.chapters[1].translationStatus, 'needs_translation');
  assert.equal(record.lastPosition.chapterIndex, 1);
  assert.equal(record.lastPosition.segmentIndex, 0);
  assert.ok(record.textSizeBytes > 100);
  assert.equal('audioBlob' in record, false);
  assert.equal('mp3Bytes' in record, false);

  const pos = buildReadingPosition(sanitizeSessionForTextStorage(session), 0, 0);
  assert.equal(pos.chapterIndex, 0);
  assert.equal(pos.chapterTitle, 'Chapitre 1 : Le départ');
  assert.ok(pos.excerpt.includes('Le navire quitte le quai'));
});
