import type {
  BookSession,
  ChapterItem,
  DetectedLanguage,
  DocumentSourceType,
} from '../types/walkman';
import { detectLikelyEnglish } from './languageDetect';
import { stripParasiticCharacters } from './speechSanitizer';

const FRENCH_WORDS_PER_MINUTE = 148;
const DEFAULT_CHAPTER_MAX_CHARS = 12000;
const GEMINI_SEGMENT_MAX_CHARS = 1200;
const LOCAL_SPEECH_MAX_CHARS = 220;

const CHAPTER_HEADING_REGEX =
  /^(?:#{1,3}\s+.+|(?:chapitre|chapter|partie|part|livre|book|tome|acte|act|prologue|épilogue|epilogue|introduction|conclusion|préface|preface|avant-propos)\b[^\n]{0,90}|(?:[IVXLCDM]{1,6}|[0-9]{1,3})\s*[.\-–—:]\s+[A-ZÀ-ÖØ-Þ][^\n]{2,80})$/i;

/**
 * Formats seconds as MM:SS or HH:MM:SS for multi-hour books.
 */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Formats long book durations cleanly in French (e.g., "4 h 18 min", "12 min", "45 s").
 */
export function formatLongDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 s';
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;
  const hours = Math.floor(total / 3600);
  const mins = Math.round((total % 3600) / 60);
  if (hours > 0) {
    if (mins === 60) return `${hours + 1} h 00 min`;
    return `${hours} h ${String(mins).padStart(2, '0')} min`;
  }
  return `${mins} min`;
}

/**
 * Estimates French speech duration in seconds (~148 words/minute at 1.0x).
 */
export function estimateFrenchSpeechSeconds(text: string, speed = 1.0): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const baseSeconds = Math.max(1, Math.round((words / FRENCH_WORDS_PER_MINUTE) * 60));
  const safeSpeed = Math.max(0.5, Math.min(2.0, speed));
  return Math.max(1, Math.round(baseSeconds / safeSpeed));
}

/**
 * Formats semitone pitch value with explicit sign (e.g., "+2.0 st", "0.0 st", "-3.5 st").
 */
export function formatPitchLabel(semitones: number): string {
  const rounded = Math.round(semitones * 10) / 10;
  if (Math.abs(rounded) < 0.05) return '0.0 st';
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)} st`;
}

/**
 * Sanitizes a title into a clean MP3 download filename.
 */
export function sanitizeMp3Filename(title: string): string {
  const normalized = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72);

  return `${normalized || 'sonobande-audio'}.mp3`;
}

/**
 * Splits text cleanly on paragraph and sentence boundaries so every segment is <= maxChars.
 */
export function splitTextIntoSegments(
  text: string,
  maxChars = GEMINI_SEGMENT_MAX_CHARS
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= maxChars) return [cleaned];

  const segments: string[] = [];
  const paragraphs = cleaned
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let current = '';
  const flush = () => {
    if (current.trim()) {
      segments.push(current.trim());
      current = '';
    }
  };

  for (const para of paragraphs) {
    if (!current && para.length <= maxChars) {
      current = para;
      continue;
    }
    if (current && current.length + 1 + para.length <= maxChars) {
      current = `${current}\n\n${para}`;
      continue;
    }

    flush();
    if (para.length <= maxChars) {
      current = para;
      continue;
    }

    // Split long paragraph by sentence endings
    const sentences = para.match(/[^.!?…]+(?:[.!?…]+["»”)]*|$)/g) ?? [para];
    for (const rawSentence of sentences) {
      const sentence = rawSentence.trim();
      if (!sentence) continue;
      if (!current && sentence.length <= maxChars) {
        current = sentence;
      } else if (current && current.length + 1 + sentence.length <= maxChars) {
        current = `${current} ${sentence}`;
      } else {
        flush();
        if (sentence.length <= maxChars) {
          current = sentence;
        } else {
          // Split exceptionally long sentence on punctuation or spaces
          const words = sentence.split(/\s+/);
          for (const word of words) {
            if (!current) {
              current = word;
            } else if (current.length + 1 + word.length <= maxChars) {
              current = `${current} ${word}`;
            } else {
              flush();
              current = word;
            }
          }
        }
      }
    }
  }

  flush();
  return segments;
}

/**
 * Splits a chapter or segment into short sentence utterances (<= 220 chars)
 * to prevent Chromium's Web Speech API 15-second cutoff bug.
 */
export function splitForLocalSpeech(text: string): string[] {
  return splitTextIntoSegments(text, LOCAL_SPEECH_MAX_CHARS);
}

/**
 * Splits a raw chapter (potentially very long) into sub-chapters if it exceeds maxChapterChars.
 */
function splitOversizedChapter(
  baseTitle: string,
  text: string,
  maxChapterChars: number
): Array<{ title: string; text: string }> {
  const cleaned = text.trim();
  if (cleaned.length <= maxChapterChars) {
    return [{ title: baseTitle, text: cleaned }];
  }

  const parts = splitTextIntoSegments(cleaned, maxChapterChars);
  if (parts.length <= 1) {
    return [{ title: baseTitle, text: cleaned }];
  }

  return parts.map((part, idx) => ({
    title: `${baseTitle} (${idx + 1}/${parts.length})`,
    text: part,
  }));
}

/**
 * Detects natural French chapter headings or splits long plain text cleanly into listening chapters.
 */
export function buildChaptersFromRawText(
  rawText: string,
  fallbackBaseTitle = 'Passage',
  maxChapterChars = DEFAULT_CHAPTER_MAX_CHARS
): ChapterItem[] {
  const normalized = rawText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const detectedSections: Array<{ title: string; lines: string[] }> = [];
  let currentSection: { title: string; lines: string[] } | null = null;
  let headingHits = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed && trimmed.length <= 100 && CHAPTER_HEADING_REGEX.test(trimmed)) {
      headingHits++;
      if (currentSection && currentSection.lines.join('\n').trim()) {
        detectedSections.push(currentSection);
      }
      const cleanHeading = trimmed.replace(/^#{1,3}\s+/, '').trim();
      currentSection = { title: cleanHeading, lines: [] };
    } else {
      if (!currentSection) {
        currentSection = { title: 'Ouverture', lines: [] };
      }
      currentSection.lines.push(rawLine);
    }
  }

  if (currentSection && currentSection.lines.join('\n').trim()) {
    detectedSections.push(currentSection);
  }

  const finalRawChapters: Array<{ title: string; text: string }> = [];

  if (headingHits >= 2 && detectedSections.length >= 2) {
    for (const sec of detectedSections) {
      const secText = sec.lines.join('\n').trim();
      if (!secText) continue;
      finalRawChapters.push(...splitOversizedChapter(sec.title, secText, maxChapterChars));
    }
  } else {
    // Plain unheaded text: split into balanced listening chapters if long
    if (normalized.length <= maxChapterChars) {
      finalRawChapters.push({ title: fallbackBaseTitle, text: normalized });
    } else {
      const parts = splitTextIntoSegments(normalized, maxChapterChars);
      parts.forEach((part, idx) => {
        finalRawChapters.push({
          title: `Partie ${idx + 1}`,
          text: part,
        });
      });
    }
  }

  return buildChapterItems(finalRawChapters);
}

/**
 * Converts a pre-extracted list of chapters (e.g. from EPUB spine or PDF groups) into ChapterItem[].
 */
export function buildChapterItems(
  rawChapters: Array<{ title: string; text: string }>,
  maxChapterChars = DEFAULT_CHAPTER_MAX_CHARS * 2
): ChapterItem[] {
  const expanded: Array<{ title: string; text: string }> = [];
  for (const ch of rawChapters) {
    const cleaned = stripParasiticCharacters(ch.text);
    if (!cleaned) continue;
    const cleanedTitle = stripParasiticCharacters(ch.title) || 'Chapitre';
    expanded.push(...splitOversizedChapter(cleanedTitle, cleaned, maxChapterChars));
  }

  return expanded.map((ch, index) => {
    const segments = splitTextIntoSegments(ch.text, GEMINI_SEGMENT_MAX_CHARS);
    return {
      id: `ch-${index + 1}`,
      index,
      title: ch.title,
      text: ch.text,
      sourceTitle: ch.title,
      sourceText: ch.text,
      translationStatus: 'french_native',
      segments,
      charCount: ch.text.length,
      estimatedSeconds: estimateFrenchSpeechSeconds(ch.text, 1.0),
    };
  });
}

/**
 * Returns a new ChapterItem updated with its translated French title, body text, and segments.
 */
export function applyChapterTranslation(
  chapter: ChapterItem,
  translatedTitle: string,
  translatedText: string
): ChapterItem {
  const cleanTitle = stripParasiticCharacters(translatedTitle) || chapter.title;
  const cleanText = stripParasiticCharacters(translatedText) || chapter.text;
  const segments = splitTextIntoSegments(cleanText, GEMINI_SEGMENT_MAX_CHARS);
  return {
    ...chapter,
    title: cleanTitle,
    text: cleanText,
    translationStatus: 'translated',
    segments,
    charCount: cleanText.length,
    estimatedSeconds: estimateFrenchSpeechSeconds(cleanText, 1.0),
  };
}

/**
 * Creates a complete ephemeral in-RAM BookSession from extracted chapters,
 * automatically detecting whether the source content is in English or French.
 */
export function createBookSession(options: {
  title: string;
  source: DocumentSourceType;
  fileName?: string;
  chapters: ChapterItem[];
  detectedLanguage?: DetectedLanguage;
}): BookSession {
  const sampleForDetection = options.chapters
    .slice(0, 4)
    .map((ch) => `${ch.sourceTitle}\n${ch.sourceText}`)
    .join('\n\n');

  const detectedLanguage: DetectedLanguage =
    options.detectedLanguage ?? detectLikelyEnglish(sampleForDetection);

  const normalizedChapters: ChapterItem[] = options.chapters.map((ch) => ({
    ...ch,
    translationStatus:
      detectedLanguage === 'en' && ch.translationStatus === 'french_native'
        ? 'needs_translation'
        : ch.translationStatus,
  }));

  const totalChars = normalizedChapters.reduce((sum, ch) => sum + ch.charCount, 0);
  const totalEstimatedSeconds = normalizedChapters.reduce(
    (sum, ch) => sum + ch.estimatedSeconds,
    0
  );

  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: options.title.trim() || 'Document sans titre',
    source: options.source,
    fileName: options.fileName,
    detectedLanguage,
    chapters: normalizedChapters,
    totalChars,
    totalEstimatedSeconds,
  };
}
