import test from 'node:test';
import assert from 'node:assert/strict';
import type { BookmarkItem } from '../types/walkman';
import {
  buildBookmarkExcerpt,
  detectLikelyEnglish,
  findDuplicateBookmark,
  sortBookmarks,
} from './languageDetect';

test('detectLikelyEnglish reliably distinguishes English books from French books', () => {
  const englishBook = `Chapter 1: The Coastal Lighthouse

  At six in the morning, the harbor still breathed the quiet of the night. Wooden hulls creaked softly against their moorings while the fog lifted above the stone jetties.`;

  const frenchBook = `Chapitre 1 : L'aube sur le port

  À six heures du matin, le port respire encore le calme de la nuit. Les coques en bois grincent doucement contre les amarres pendant que la brume se lève.`;

  assert.equal(detectLikelyEnglish(englishBook), 'en');
  assert.equal(detectLikelyEnglish(frenchBook), 'fr');
});

test('detectLikelyEnglish handles short or empty strings safely without false positives', () => {
  assert.equal(detectLikelyEnglish(''), 'fr');
  assert.equal(detectLikelyEnglish('Bonjour'), 'fr');
  assert.equal(
    detectLikelyEnglish('The storm was coming from the northern sea and they were ready.'),
    'en'
  );
});

test('buildBookmarkExcerpt trims whitespace and cuts cleanly at word boundaries', () => {
  const longText =
    'Derrière les vitrines embuées, les rayons débordent de romans anciens et de carnets reliés de toile. Le libraire prépare son café en feuilletant une édition de poche très rare.';
  const excerpt = buildBookmarkExcerpt(longText, 75);

  assert.ok(excerpt.length <= 76);
  assert.ok(excerpt.endsWith('…'));
  assert.ok(!excerpt.includes('\n'));
  assert.equal(buildBookmarkExcerpt('   '), 'Passage marqué');
});

test('sortBookmarks and findDuplicateBookmark maintain deterministic reading order', () => {
  const items: BookmarkItem[] = [
    {
      id: 'b2',
      chapterId: 'ch-2',
      chapterIndex: 1,
      chapterTitle: 'Chapitre 2',
      segmentIndex: 0,
      totalSegments: 2,
      excerpt: 'Deuxième chapitre',
      note: '',
      createdAt: 200,
    },
    {
      id: 'b1',
      chapterId: 'ch-1',
      chapterIndex: 0,
      chapterTitle: 'Chapitre 1',
      segmentIndex: 2,
      totalSegments: 3,
      excerpt: 'Premier chapitre, fin',
      note: 'Important',
      createdAt: 300,
    },
    {
      id: 'b0',
      chapterId: 'ch-1',
      chapterIndex: 0,
      chapterTitle: 'Chapitre 1',
      segmentIndex: 0,
      totalSegments: 3,
      excerpt: 'Premier chapitre, début',
      note: '',
      createdAt: 400,
    },
  ];

  const sorted = sortBookmarks(items);
  assert.deepEqual(
    sorted.map((b) => b.id),
    ['b0', 'b1', 'b2']
  );

  assert.equal(findDuplicateBookmark(sorted, 0, 2)?.id, 'b1');
  assert.equal(findDuplicateBookmark(sorted, 2, 0), undefined);
});
