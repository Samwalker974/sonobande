import type { ChapterItem } from '../types/walkman';

export type TocEntryKind = 'frontmatter' | 'part' | 'chapter' | 'backmatter';

export interface TocEntry {
  chapterIndex: number;
  chapter: ChapterItem;
  kind: TocEntryKind;
  displayTitle: string;
  badgeLabel: string;
  chapterNumber: number | null;
  partNumber: number | null;
  parentPartIndex: number | null;
  parentPartTitle: string | null;
  depth: 0 | 1;
}

export interface BookTocSummary {
  entries: TocEntry[];
  frontmatterCount: number;
  partCount: number;
  chapterCount: number;
  backmatterCount: number;
  hasParts: boolean;
}

const GENERIC_FALLBACK_TITLE_REGEX =
  /^(?:chapitre|chapter|section|passage)\s+\d+$|^ouverture$|^pages?\s+pr[eé]liminaires$/i;

const EXPLICIT_PART_TITLE_REGEX =
  /^(?:(?:premi[eè]re|deuxi[eè]me|troisi[eè]me|quatri[eè]me|cinqui[eè]me|sixi[eè]me|septi[eè]me|huiti[eè]me|neuvi[eè]me|dixi[eè]me|first|second|third|fourth|fifth|\d+(?:[eè]re|[eè]me|e|st|nd|rd|th)?)\s+(?:partie|part|livre|book|tome|acte|act|volume)|(?:partie|part|livre|book|tome|acte|act|volume)\s+(?:[IVXLCDM]{1,6}|\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|premier|premi[eè]re|second|seconde|one|two|three|four|five))\b/i;

const EXPLICIT_CHAPTER_TITLE_REGEX =
  /^(?:chapitre|chapter|chap\.?)\s*(?:[IVXLCDM]{1,6}|\d{1,3}|premier|premi[eè]re|un|deux|trois|quatre|cinq|one|two|three)\b|^(?:[IVXLCDM]{1,6}|\d{1,3})\s*[.\-–—:]\s+\S+/i;

const FRONTMATTER_TITLE_REGEX =
  /^(?:couverture|cover|page\s+de\s+titre|title\s*page|faux[\s-]titre|half[\s-]title|copyright|mentions?\s*(?:l[eé]gales?|[&e]\s*[eé]dition)?|cr[eé]dits?|credits?|d[eé]p[oô]t\s+l[eé]gal|achev[eé]\s+d['’]imprimer|colophon|d[eé]dicace|dedication|[eé]pigraphe|epigraph|remerciements?|acknowledgm?ents?|avant[\s-]propos|foreword|pr[eé]face|preface|avertissement|note\s+de\s+l['’](?:auteur|autrice|[eé]diteur|traducteur)|author['’]s\s+note|editor['’]s\s+note|sommaire|table\s+des\s+mati[eè]res|table\s+of\s+contents|contents|ouverture|pages?\s+pr[eé]liminaires|informations?\s+du\s+livre|du\s+m[eê]me\s+auteur|also\s+by|liste\s+des\s+personnages|dramatis\s+personae|introduction|prologue)\b/i;

const BACKMATTER_TITLE_REGEX =
  /^(?:[eé]pilogue|epilogue|postface|afterword|conclusion|annexes?|appendix|appendices|glossaire|glossary|bibliographie|bibliography|notes?\s*(?:de\s+fin|et\s+r[eé]f[eé]rences?)?|remerciements?|acknowledgm?ents?|[àa]\s+propos\s+de\s+l['’](?:auteur|autrice)|about\s+the\s+author|du\s+m[eê]me\s+auteur|also\s+by|colophon|achev[eé]\s+d['’]imprimer|cr[eé]dits?|mentions?\s+l[eé]gales?|index)\b/i;

const COPYRIGHT_OR_PUBLISHING_TEXT_REGEX =
  /(?:©|\bcopyright\b|\bisbn\b|\btous\s+droits\s+r[eé]serv[eé]s\b|\ball\s+rights\s+reserved\b|\bd[eé]p[oô]t\s+l[eé]gal\b|\bpublished\s+by\b|\b[eé]ditions?\b|\bimprim[eé]\s+en\b|\bachevé\s+d['’]imprimer\b|\bphotocopillage\b|\bcode\s+de\s+la\s+propri[eé]t[eé]\s+intellectuelle\b)/i;

const TOC_BODY_TEXT_REGEX =
  /(?:^\s*(?:sommaire|table\s+des\s+mati[eè]res|table\s+of\s+contents|contents)\b)/i;

const DEDICATION_BODY_TEXT_REGEX =
  /^(?:[àa]\s+(?:mon|ma|mes|tous|toutes|toi|vous)\b|pour\s+(?:mon|ma|mes|toi|vous)\b|for\s+(?:my|all)\b|to\s+(?:my|all)\b|en\s+m[eé]moire\s+de\b|in\s+memory\s+of\b)/i;

function normalizeTextForCompare(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function inferFrontmatterTitleFromContent(
  rawTitle: string,
  text: string,
  bookTitle?: string
): string {
  const trimmedTitle = rawTitle.trim();
  const isGeneric = !trimmedTitle || GENERIC_FALLBACK_TITLE_REGEX.test(trimmedTitle);
  const sample = text.trim().slice(0, 1200);

  if (!isGeneric && !bookTitleMatches(trimmedTitle, bookTitle)) {
    return trimmedTitle;
  }

  if (TOC_BODY_TEXT_REGEX.test(sample)) {
    return 'Sommaire du livre';
  }
  if (COPYRIGHT_OR_PUBLISHING_TEXT_REGEX.test(sample)) {
    return 'Mentions & édition';
  }
  if (text.trim().length <= 420 && DEDICATION_BODY_TEXT_REGEX.test(sample)) {
    return 'Dédicace';
  }
  if (
    bookTitleMatches(trimmedTitle, bookTitle) ||
    (text.trim().length <= 360 &&
      bookTitle &&
      normalizeTextForCompare(sample).includes(normalizeTextForCompare(bookTitle)))
  ) {
    return 'Page de titre';
  }
  return 'Pages préliminaires';
}

function bookTitleMatches(candidate: string, bookTitle?: string): boolean {
  if (!bookTitle) return false;
  const a = normalizeTextForCompare(candidate);
  const b = normalizeTextForCompare(bookTitle);
  return Boolean(a && b && (a === b || (a.length >= 6 && b.includes(a))));
}

function isInfoFrontmatterContent(
  chapter: ChapterItem,
  bookTitle?: string
): boolean {
  const titleCandidate = chapter.title.trim();
  const sourceTitleCandidate = chapter.sourceTitle.trim();
  const textSample = (chapter.text || chapter.sourceText).trim();

  if (
    FRONTMATTER_TITLE_REGEX.test(titleCandidate) ||
    FRONTMATTER_TITLE_REGEX.test(sourceTitleCandidate)
  ) {
    return true;
  }

  if (bookTitleMatches(titleCandidate, bookTitle) || bookTitleMatches(sourceTitleCandidate, bookTitle)) {
    return true;
  }

  // Short copyright/publishing/title-page/dedication pages before Chapter 1
  if (
    textSample.length <= 2400 &&
    (COPYRIGHT_OR_PUBLISHING_TEXT_REGEX.test(textSample) ||
      TOC_BODY_TEXT_REGEX.test(textSample) ||
      (textSample.length <= 420 && DEDICATION_BODY_TEXT_REGEX.test(textSample)))
  ) {
    return true;
  }

  // Generic unnamed short opening page (e.g., cover/title info with < 900 chars)
  if (
    textSample.length <= 900 &&
    (GENERIC_FALLBACK_TITLE_REGEX.test(titleCandidate) ||
      GENERIC_FALLBACK_TITLE_REGEX.test(sourceTitleCandidate))
  ) {
    return true;
  }

  return false;
}

/**
 * Classifies a book's ChapterItem[] into a structured hierarchical Sommaire (Table of Contents):
 * - Opening info / front-matter pages are NEVER mislabeled as "Chapitre"
 * - Parties / Livres / Tomes / Actes become visual parent group headers
 * - Real chapters are numbered sequentially (starting at 1) and indented under their parent Part
 * - Closing sections (Épilogue, Postface, Annexes, Notes...) are tagged cleanly as closing sections
 */
export function buildBookToc(
  chapters: ChapterItem[],
  bookTitle?: string
): BookTocSummary {
  if (chapters.length === 0) {
    return {
      entries: [],
      frontmatterCount: 0,
      partCount: 0,
      chapterCount: 0,
      backmatterCount: 0,
      hasParts: false,
    };
  }

  const isPartCandidate = (ch: ChapterItem) =>
    EXPLICIT_PART_TITLE_REGEX.test(ch.title.trim()) ||
    EXPLICIT_PART_TITLE_REGEX.test(ch.sourceTitle.trim());

  const isExplicitChapterCandidate = (ch: ChapterItem) =>
    EXPLICIT_CHAPTER_TITLE_REGEX.test(ch.title.trim()) ||
    EXPLICIT_CHAPTER_TITLE_REGEX.test(ch.sourceTitle.trim());

  // Plain auto-split unheaded text produces "Partie 1", "Partie 2", "Partie 3" with NO chapters under them.
  // Only treat "Partie" headings as hierarchical parent dividers if there are real non-part sections too.
  const partCandidateCount = chapters.filter(isPartCandidate).length;
  const nonPartCount = chapters.length - partCandidateCount;
  const treatPartsAsDividers = partCandidateCount > 0 && nonPartCount > 0;

  // Locate the first real chapter or part divider so opening info pages before it are caught reliably
  let firstStoryIndex = -1;
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (
      (treatPartsAsDividers && isPartCandidate(ch)) ||
      (isExplicitChapterCandidate(ch) && !GENERIC_FALLBACK_TITLE_REGEX.test(ch.sourceTitle.trim()))
    ) {
      firstStoryIndex = i;
      break;
    }
  }

  // Pass 1: classify each item's structural kind
  const rawKinds: TocEntryKind[] = new Array(chapters.length).fill('chapter');

  let seenRealStory = false;
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const title = ch.title.trim();
    const sourceTitle = ch.sourceTitle.trim();

    if (treatPartsAsDividers && isPartCandidate(ch)) {
      rawKinds[i] = 'part';
      seenRealStory = true;
      continue;
    }

    if (!seenRealStory) {
      const beforeExplicitStory = firstStoryIndex > 0 && i < firstStoryIndex;
      if (
        isInfoFrontmatterContent(ch, bookTitle) ||
        (beforeExplicitStory && (ch.text || ch.sourceText).trim().length <= 1800)
      ) {
        rawKinds[i] = 'frontmatter';
        continue;
      }
      seenRealStory = true;
    }

    // Back-matter only after at least one real story item and near the tail of the book
    if (
      seenRealStory &&
      i >= Math.max(1, chapters.length - 6) &&
      (BACKMATTER_TITLE_REGEX.test(title) || BACKMATTER_TITLE_REGEX.test(sourceTitle))
    ) {
      rawKinds[i] = 'backmatter';
      continue;
    }

    rawKinds[i] = 'chapter';
  }

  // Safety guard: if every single section ended up as frontmatter (e.g. a tiny 1-page note),
  // keep it as frontmatter only when it's explicitly frontmatter; otherwise don't break playback labels.
  const hasParts = rawKinds.some((k) => k === 'part');

  // Pass 2: build TocEntry list with proper numbering and parent Part nesting
  const entries: TocEntry[] = [];
  let frontmatterCount = 0;
  let partCount = 0;
  let chapterCount = 0;
  let backmatterCount = 0;
  let currentPartIndex: number | null = null;
  let currentPartTitle: string | null = null;

  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    const kind = rawKinds[i];
    const isUntranslated = ch.translationStatus === 'needs_translation';
    const rawVisibleTitle = isUntranslated ? ch.sourceTitle : ch.title;

    if (kind === 'frontmatter') {
      frontmatterCount++;
      const displayTitle = inferFrontmatterTitleFromContent(
        rawVisibleTitle,
        ch.text || ch.sourceText,
        bookTitle
      );
      entries.push({
        chapterIndex: i,
        chapter: ch,
        kind,
        displayTitle,
        badgeLabel: 'Infos',
        chapterNumber: null,
        partNumber: null,
        parentPartIndex: null,
        parentPartTitle: null,
        depth: 0,
      });
      continue;
    }

    if (kind === 'part') {
      partCount++;
      const displayTitle = rawVisibleTitle.trim() || `Partie ${partCount}`;
      currentPartIndex = i;
      currentPartTitle = displayTitle;
      entries.push({
        chapterIndex: i,
        chapter: ch,
        kind,
        displayTitle,
        badgeLabel: `Partie ${partCount}`,
        chapterNumber: null,
        partNumber: partCount,
        parentPartIndex: null,
        parentPartTitle: null,
        depth: 0,
      });
      continue;
    }

    if (kind === 'backmatter') {
      backmatterCount++;
      const displayTitle = rawVisibleTitle.trim() || 'Annexe';
      // Back-matter sits outside the last Part
      currentPartIndex = null;
      currentPartTitle = null;
      entries.push({
        chapterIndex: i,
        chapter: ch,
        kind,
        displayTitle,
        badgeLabel: 'Fin',
        chapterNumber: null,
        partNumber: null,
        parentPartIndex: null,
        parentPartTitle: null,
        depth: 0,
      });
      continue;
    }

    chapterCount++;
    const displayTitle = rawVisibleTitle.trim() || `Chapitre ${chapterCount}`;
    entries.push({
      chapterIndex: i,
      chapter: ch,
      kind: 'chapter',
      displayTitle,
      badgeLabel: `Ch. ${chapterCount}`,
      chapterNumber: chapterCount,
      partNumber: null,
      parentPartIndex: currentPartIndex,
      parentPartTitle: currentPartTitle,
      depth: currentPartIndex !== null ? 1 : 0,
    });
  }

  return {
    entries,
    frontmatterCount,
    partCount,
    chapterCount,
    backmatterCount,
    hasParts,
  };
}

/**
 * Formats a concise human-readable location label for the active TOC entry
 * (never calls front-matter/info pages "Chapitre").
 */
export function formatTocLocationLabel(toc: BookTocSummary, activeIndex: number): string {
  const entry = toc.entries[activeIndex];
  if (!entry) return 'Aucune section';

  if (entry.kind === 'frontmatter') {
    return entry.displayTitle;
  }
  if (entry.kind === 'part') {
    return entry.displayTitle;
  }
  if (entry.kind === 'backmatter') {
    return entry.displayTitle;
  }

  const chapterTotal = Math.max(1, toc.chapterCount);
  const chapterPart = `Chapitre ${entry.chapterNumber ?? activeIndex + 1} / ${chapterTotal}`;
  return entry.parentPartTitle ? `${chapterPart}` : chapterPart;
}

/**
 * Compact badge for narrow surfaces (cassette top stripe, fullscreen Sommaire button).
 */
export function formatTocCompactBadge(toc: BookTocSummary, activeIndex: number): string {
  const entry = toc.entries[activeIndex];
  if (!entry) return 'Sommaire';

  if (entry.kind === 'frontmatter') {
    return 'Infos';
  }
  if (entry.kind === 'part') {
    return entry.badgeLabel;
  }
  if (entry.kind === 'backmatter') {
    return 'Fin';
  }
  return `Ch. ${entry.chapterNumber ?? activeIndex + 1}/${Math.max(1, toc.chapterCount)}`;
}

/**
 * Human summary of the Sommaire counts (e.g., "3 parties · 14 chapitres · 2 pages d'infos").
 */
export function formatTocCompositionSummary(toc: BookTocSummary): string {
  const parts: string[] = [];
  if (toc.partCount > 0) {
    parts.push(`${toc.partCount} ${toc.partCount > 1 ? 'parties' : 'partie'}`);
  }
  if (toc.chapterCount > 0) {
    parts.push(`${toc.chapterCount} ${toc.chapterCount > 1 ? 'chapitres' : 'chapitre'}`);
  }
  if (toc.frontmatterCount > 0) {
    parts.push(
      `${toc.frontmatterCount} ${toc.frontmatterCount > 1 ? 'pages d’infos' : 'page d’infos'}`
    );
  }
  if (toc.backmatterCount > 0) {
    parts.push(`${toc.backmatterCount} ${toc.backmatterCount > 1 ? 'annexes' : 'annexe'}`);
  }
  return parts.join(' · ') || `${toc.entries.length} sections`;
}
