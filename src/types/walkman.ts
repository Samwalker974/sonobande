export type NeuralVoiceId =
  | 'fr-FR-DeniseNeural'
  | 'fr-FR-HenriNeural'
  | 'fr-FR-VivienneMultilingualNeural'
  | 'fr-FR-RemyMultilingualNeural'
  | 'fr-FR-EloiseNeural';

export type DocumentSourceType = 'paste' | 'pdf' | 'epub' | 'txt';

export type TransportState = 'stopped' | 'playing' | 'paused' | 'buffering';

export type DetectedLanguage = 'fr' | 'en';

export type ChapterTranslationStatus =
  | 'french_native'
  | 'needs_translation'
  | 'translating'
  | 'translated';

export interface NeuralVoiceProfile {
  id: NeuralVoiceId;
  name: string;
  gender: 'Féminine' | 'Masculine';
  timbre: string;
  description: string;
}

export interface ChapterItem {
  id: string;
  index: number;
  title: string;
  text: string;
  sourceTitle: string;
  sourceText: string;
  translationStatus: ChapterTranslationStatus;
  segments: string[];
  charCount: number;
  estimatedSeconds: number;
}

export interface BookSession {
  id: string;
  title: string;
  source: DocumentSourceType;
  fileName?: string;
  detectedLanguage: DetectedLanguage;
  chapters: ChapterItem[];
  totalChars: number;
  totalEstimatedSeconds: number;
}

export interface BookmarkItem {
  id: string;
  chapterId: string;
  chapterIndex: number;
  chapterTitle: string;
  segmentIndex: number;
  totalSegments: number;
  excerpt: string;
  note: string;
  createdAt: number;
}

export interface ReadingPosition {
  chapterIndex: number;
  chapterTitle: string;
  segmentIndex: number;
  totalSegments: number;
  excerpt: string;
  updatedAt: number;
}

export interface SavedBookRecord {
  id: string;
  session: BookSession;
  bookmarks: BookmarkItem[];
  lastPosition: ReadingPosition;
  savedAt: number;
  updatedAt: number;
  textSizeBytes: number;
}

export interface BrowserStorageMetrics {
  booksCount: number;
  libraryTextBytes: number;
  browserUsageBytes: number | null;
  browserQuotaBytes: number | null;
  remainingBytes: number | null;
  percentUsed: number | null;
}

export interface TranslationProgress {
  completedChapters: number;
  totalChapters: number;
  currentLabel: string;
}

export type ExportStageId =
  | 'preparing'
  | 'translating'
  | 'synthesizing'
  | 'encoding'
  | 'packaging';

export interface ExportProgress {
  scope: 'chapter' | 'book';
  stage: ExportStageId;
  stageHeadline: string;
  detail: string;
  label: string;
  completedSegments: number;
  totalSegments: number;
  stepIndex: number;
  totalSteps: number;
}

export interface ReadyMp3Download {
  url: string;
  filename: string;
  sizeBytes: number;
  createdAt: number;
}

export interface SampleScript {
  id: string;
  title: string;
  language: DetectedLanguage;
  text: string;
}
