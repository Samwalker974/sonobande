import type { BookmarkItem, DetectedLanguage } from '../types/walkman';

const ENGLISH_STOPWORDS = new Set([
  'the',
  'and',
  'of',
  'to',
  'in',
  'is',
  'was',
  'that',
  'for',
  'with',
  'as',
  'his',
  'her',
  'they',
  'from',
  'were',
  'this',
  'which',
  'their',
  'would',
  'there',
  'been',
  'have',
  'had',
  'not',
  'but',
  'she',
  'you',
  'are',
  'into',
  'upon',
  'about',
  'could',
  'through',
  'after',
  'before',
  'between',
  'where',
  'when',
  'while',
  'what',
  'your',
  'our',
  'out',
  'over',
  'under',
  'chapter',
  'lighthouse',
  'morning',
  'night',
]);

const FRENCH_STOPWORDS = new Set([
  'le',
  'la',
  'les',
  'des',
  'un',
  'une',
  'et',
  'est',
  'dans',
  'que',
  'qui',
  'pour',
  'pas',
  'sur',
  'avec',
  'plus',
  'sont',
  'mais',
  'nous',
  'vous',
  'cette',
  'tout',
  'comme',
  'elle',
  'ils',
  'elles',
  'aussi',
  'était',
  'avait',
  'être',
  'avoir',
  'chapitre',
  'au',
  'aux',
  'du',
  'ce',
  'ces',
  'ses',
  'son',
  'sa',
  'dans',
  'par',
  'sans',
  'sous',
  'vers',
  'chez',
  'entre',
  'dont',
  'où',
]);

const FRENCH_DIACRITIC_REGEX = /[éèêëàâçîïôùûüœæ]/i;

/**
 * Deterministically detects whether a document or pasted excerpt is predominantly English or French.
 * Runs 100% locally in memory with zero network calls.
 */
export function detectLikelyEnglish(text: string): DetectedLanguage {
  const sample = text.slice(0, 12000).toLowerCase();
  const tokens = sample.match(/[a-zà-öø-ÿœæ']+/gi) ?? [];
  if (tokens.length < 5) {
    return 'fr';
  }

  let enScore = 0;
  let frScore = 0;
  let diacriticTokens = 0;

  const limit = Math.min(tokens.length, 1800);
  for (let i = 0; i < limit; i++) {
    const raw = tokens[i];
    if (FRENCH_DIACRITIC_REGEX.test(raw)) {
      diacriticTokens++;
    }

    // Handle French elisions like l'aube, d'un, qu'il
    if (/^(?:l|d|qu|j|n|s|c|m|t)'[a-zà-öø-ÿ]/i.test(raw)) {
      frScore += 1.5;
      continue;
    }

    if (ENGLISH_STOPWORDS.has(raw)) {
      enScore += 1;
    }
    if (FRENCH_STOPWORDS.has(raw)) {
      frScore += 1;
    }
  }

  // French diacritics are a strong signal when present across the text
  const diacriticRatio = diacriticTokens / limit;
  frScore += diacriticRatio * limit * 0.45;

  if (enScore >= 3 && enScore > frScore * 1.25) {
    return 'en';
  }

  return 'fr';
}

/**
 * Produces a clean, readable single-line excerpt for a session bookmark.
 */
export function buildBookmarkExcerpt(text: string, maxLength = 155): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'Passage marqué';
  if (compact.length <= maxLength) return compact;

  const sliced = compact.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(' ');
  const safeCut = lastSpace > Math.floor(maxLength * 0.6) ? sliced.slice(0, lastSpace) : sliced;
  return `${safeCut.replace(/[,;:\s]+$/, '')}…`;
}

/**
 * Sorts bookmarks in natural reading order: chapter index asc, segment index asc, creation time asc.
 */
export function sortBookmarks(bookmarks: BookmarkItem[]): BookmarkItem[] {
  return [...bookmarks].sort((a, b) => {
    if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex;
    if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
    return a.createdAt - b.createdAt;
  });
}

/**
 * Finds an existing bookmark pointing to the exact same (chapterIndex, segmentIndex) location.
 */
export function findDuplicateBookmark(
  bookmarks: BookmarkItem[],
  chapterIndex: number,
  segmentIndex: number
): BookmarkItem | undefined {
  return bookmarks.find(
    (bm) => bm.chapterIndex === chapterIndex && bm.segmentIndex === segmentIndex
  );
}
