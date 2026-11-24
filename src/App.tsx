import { useCallback, useEffect, useRef, useState } from 'react';
import * as vits from '@diffusionstudio/vits-web';
import { BookLibrary } from './components/BookLibrary';
import { ChapterList } from './components/ChapterList';
import { ChapterReader } from './components/ChapterReader';
import { TextStudio } from './components/TextStudio';
import { TopBar } from './components/TopBar';
import { WalkmanDeck } from './components/WalkmanDeck';
import { WalkmanQuickControls } from './components/WalkmanQuickControls';
import { getNeuralVoiceById } from './constants/voices';
import { useWalkmanAudio } from './hooks/useWalkmanAudio';
import type {
  BookmarkItem,
  BookSession,
  BrowserStorageMetrics,
  ChapterItem,
  ExportProgress,
  NeuralVoiceId,
  ReadyMp3Download,
  SampleScript,
  SavedBookRecord,
  TranslationProgress,
} from './types/walkman';
import {
  DEFAULT_PAUSE_DURATION_SECONDS,
  insertSilenceAtOffsets,
  processAudioSpeedPitch,
} from './utils/audioDsp';
import {
  applyChapterTranslation,
  buildChaptersFromRawText,
  createBookSession,
  sanitizeMp3Filename,
} from './utils/bookSplitter';
import {
  clearAllSavedBooks,
  createSavedBookRecord,
  deleteSavedBook,
  getLastActiveBookId,
  loadAllSavedBooks,
  measureBrowserStorage,
  saveBookRecord,
  setLastActiveBookId,
} from './utils/bookStorage';
import { importDocumentFile } from './utils/documentParser';
import {
  getDocumentTextSizeError,
  MAX_AUTO_SAVED_DOCUMENT_CHARS,
} from './utils/documentLimits';
import { polishFrenchTitle, polishFrenchTranslation } from './utils/frenchPolish';
import {
  buildBookmarkExcerpt,
  findDuplicateBookmark,
  sortBookmarks,
} from './utils/languageDetect';
import {
  createMp3ObjectUrl,
  IncrementalMp3Builder,
  triggerDownloadFromObjectUrl,
} from './utils/mp3Encoder';
import { translateInBrowser } from './utils/browserTranslation';
import { purgeLegacyLocalData } from './utils/privacyCleanup';

const INITIAL_STORAGE_METRICS: BrowserStorageMetrics = {
  booksCount: 0,
  libraryTextBytes: 0,
  browserUsageBytes: null,
  browserQuotaBytes: null,
  remainingBytes: null,
  percentUsed: null,
};

function buildDraftPreview(bookSession: BookSession): string {
  return bookSession.totalChars > 60000
    ? bookSession.chapters[0]?.sourceText ?? ''
    : bookSession.chapters.map((c) => `${c.sourceTitle}\n\n${c.sourceText}`).join('\n\n');
}

async function isVoiceModelCached(voiceId: NeuralVoiceId): Promise<boolean> {
  if (window.localStorage.getItem(`sonobande:voice:${voiceId}:installed`) === 'true') {
    return true;
  }

  if (!navigator.storage?.getDirectory) return false;

  try {
    const originDirectory = await navigator.storage.getDirectory();
    const piperDirectory = await originDirectory.getDirectoryHandle('piper');
    await piperDirectory.getFileHandle(`${voiceId}.onnx`);
    await piperDirectory.getFileHandle(`${voiceId}.onnx.json`);
    return true;
  } catch {
    return false;
  }
}

async function waitForVoiceModelCache(
  voiceId: NeuralVoiceId,
  attempts = 30
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await isVoiceModelCached(voiceId)) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  return false;
}

function supportsVoiceModelStorage(): boolean {
  return window.isSecureContext && Boolean(navigator.storage?.getDirectory);
}

export default function App() {
  // Active book state (text + bookmarks + stop position are persisted in IndexedDB; MP3/audio stay strictly in RAM)
  const [session, setSession] = useState<BookSession | null>(null);
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);

  // Browser text-only library & storage metrics
  const [savedBooks, setSavedBooks] = useState<SavedBookRecord[]>([]);
  const [storageMetrics, setStorageMetrics] =
    useState<BrowserStorageMetrics>(INITIAL_STORAGE_METRICS);

  // Studio draft state
  const [draftTitle, setDraftTitle] = useState('');
  const [draftText, setDraftText] = useState('');

  const neuralVoiceId: NeuralVoiceId = 'fr_FR-siwis-medium';
  const [voiceModelStatus, setVoiceModelStatus] = useState<
    'checking' | 'missing' | 'downloading' | 'ready' | 'error' | 'unsupported'
  >('checking');
  const [showVoiceDownload, setShowVoiceDownload] = useState(false);
  const [voiceDownloadPercent, setVoiceDownloadPercent] = useState(0);
  const [voiceDownloadMessage, setVoiceDownloadMessage] = useState('');

  // English -> French translation settings & progress
  const [autoTranslateToFrench, setAutoTranslateToFrench] = useState<boolean>(true);
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [browserTranslationStatus, setBrowserTranslationStatus] = useState<string | null>(null);

  // Listening personalization
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitchSemitones, setPitchSemitones] = useState<number>(0);
  const [pauseDurationSeconds, setPauseDurationSeconds] = useState(
    DEFAULT_PAUSE_DURATION_SECONDS
  );
  const [volume, setVolume] = useState<number>(0.88);
  const [muted, setMuted] = useState<boolean>(false);

  // Import, errors & MP3 export progress
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [importStatusLabel, setImportStatusLabel] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);
  const [readyMp3, setReadyMp3] = useState<ReadyMp3Download | null>(null);

  const sessionRef = useRef<BookSession | null>(null);
  sessionRef.current = session;
  const savedBooksRef = useRef<SavedBookRecord[]>(savedBooks);
  savedBooksRef.current = savedBooks;
  const readyMp3UrlRef = useRef<string | null>(null);
  const autoTranslateRef = useRef<boolean>(autoTranslateToFrench);
  autoTranslateRef.current = autoTranslateToFrench;

  const exportAbortRef = useRef<AbortController | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const inflightTranslationsRef = useRef<Map<string, Promise<ChapterItem>>>(new Map());
  const pendingAutoPlayRef = useRef<boolean>(false);
  const hasHydratedStorageRef = useRef<boolean>(false);
  const pendingRestorePositionRef = useRef<{
    bookId: string;
    chapterIndex: number;
    segmentIndex: number;
    autoPlay: boolean;
  } | null>(null);

  const replaceReadyMp3 = useCallback((next: ReadyMp3Download | null) => {
    if (readyMp3UrlRef.current && readyMp3UrlRef.current !== next?.url) {
      URL.revokeObjectURL(readyMp3UrlRef.current);
    }
    readyMp3UrlRef.current = next?.url ?? null;
    setReadyMp3(next);
  }, []);

  // Hydrate browser text-only library on startup, restore last opened book & stop position, and clean up legacy keys
  useEffect(() => {
    let cancelled = false;
    purgeLegacyLocalData();

    void (async () => {
      const books = await loadAllSavedBooks();
      const lastActiveId = await getLastActiveBookId();
      const metrics = await measureBrowserStorage(books);
      if (cancelled) return;

      savedBooksRef.current = books;
      setSavedBooks(books);
      setStorageMetrics(metrics);

      if (books.length > 0) {
        const target = books.find((b) => b.id === lastActiveId) ?? books[0];
        pendingRestorePositionRef.current = {
          bookId: target.id,
          chapterIndex: target.lastPosition.chapterIndex,
          segmentIndex: target.lastPosition.segmentIndex,
          autoPlay: false,
        };
        sessionRef.current = target.session;
        setSession(target.session);
        setBookmarks(target.bookmarks);
        setActiveChapterIndex(target.lastPosition.chapterIndex);
        setDraftTitle(target.session.title);
        setDraftText(buildDraftPreview(target.session));
      }

      hasHydratedStorageRef.current = true;
    })();

    return () => {
      cancelled = true;
      if (readyMp3UrlRef.current) {
        URL.revokeObjectURL(readyMp3UrlRef.current);
        readyMp3UrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!supportsVoiceModelStorage()) {
        if (cancelled) return;
        setVoiceModelStatus('unsupported');
        setVoiceDownloadMessage(
          'Le stockage des modèles vocaux exige une origine sécurisée. Ouvrez cette application sur le même ordinateur via http://localhost:3000/sonobande/ ou utilisez la version HTTPS.'
        );
        setShowVoiceDownload(true);
        return;
      }

      try {
        const storedVoice = await isVoiceModelCached(neuralVoiceId);
        if (cancelled) return;

        if (storedVoice) {
          setVoiceModelStatus('ready');
        } else {
          setVoiceModelStatus('missing');
          setShowVoiceDownload(true);
        }
      } catch {
        if (cancelled) return;
        setVoiceModelStatus('error');
        setShowVoiceDownload(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [neuralVoiceId]);

  const translateChapter = useCallback(
    async (chapterIndex: number, signal?: AbortSignal): Promise<ChapterItem | null> => {
      const currentSession = sessionRef.current;
      if (!currentSession) return null;
      const target = currentSession.chapters[chapterIndex];
      if (!target) return null;

      if (target.translationStatus === 'translated') {
        return target;
      }
      if (target.translationStatus === 'french_native') {
        return target;
      }

      const inflightKey = `${currentSession.id}|${target.id}`;
      const existingPromise = inflightTranslationsRef.current.get(inflightKey);
      if (existingPromise) {
        return existingPromise;
      }
      if (target.translationStatus === 'translating') {
        return target;
      }

      const prevStatus = target.translationStatus;
      const sessionIdAtStart = currentSession.id;

      // Mark chapter as translating in RAM
      setSession((prev) => {
        if (!prev || prev.id !== sessionIdAtStart) return prev;
        const nextChapters = prev.chapters.map((ch, idx) =>
          idx === chapterIndex ? { ...ch, translationStatus: 'translating' as const } : ch
        );
        const updated = { ...prev, chapters: nextChapters };
        sessionRef.current = updated;
        return updated;
      });

      const task = (async (): Promise<ChapterItem> => {
        const payload = await translateInBrowser(target.sourceTitle, target.sourceText, {
          signal,
          onProgress: setBrowserTranslationStatus,
        });

        const finalTitle = polishFrenchTitle(payload.translatedTitle || target.sourceTitle);
        const finalText = polishFrenchTranslation(payload.translatedText);

        const translatedChapter = applyChapterTranslation(target, finalTitle, finalText);

        setSession((prev) => {
          if (!prev || prev.id !== sessionIdAtStart) return prev;
          const nextChapters = prev.chapters.map((ch, idx) =>
            idx === chapterIndex ? translatedChapter : ch
          );
          const totalChars = nextChapters.reduce((sum, ch) => sum + ch.charCount, 0);
          const totalEstimatedSeconds = nextChapters.reduce(
            (sum, ch) => sum + ch.estimatedSeconds,
            0
          );
          const updated: BookSession = {
            ...prev,
            detectedLanguage: 'en',
            chapters: nextChapters,
            totalChars,
            totalEstimatedSeconds,
          };
          sessionRef.current = updated;
          return updated;
        });

        // Keep any existing bookmarks aligned with the translated French chapter title
        setBookmarks((prev) =>
          prev.map((bm) =>
            bm.chapterId === target.id
              ? {
                  ...bm,
                  chapterTitle: translatedChapter.title,
                  totalSegments: translatedChapter.segments.length,
                }
              : bm
          )
        );

        return translatedChapter;
      })();

      inflightTranslationsRef.current.set(inflightKey, task);

      try {
        return await task;
      } catch (err) {
        // Restore prior chapter translation status if aborted or failed
        setSession((prev) => {
          if (!prev || prev.id !== sessionIdAtStart) return prev;
          const nextChapters = prev.chapters.map((ch, idx) =>
            idx === chapterIndex && ch.translationStatus === 'translating'
              ? { ...ch, translationStatus: prevStatus }
              : ch
          );
          const updated = { ...prev, chapters: nextChapters };
          sessionRef.current = updated;
          return updated;
        });
        throw err;
      } finally {
        setBrowserTranslationStatus(null);
        inflightTranslationsRef.current.delete(inflightKey);
      }
    },
    []
  );

  const handleBeforePlayChapter = useCallback(
    async (chapterIndex: number): Promise<ChapterItem | null> => {
      const currentSession = sessionRef.current;
      const chapter = currentSession?.chapters[chapterIndex];
      if (!chapter) return null;

      if (chapter.translationStatus === 'needs_translation') {
        if (!autoTranslateRef.current) {
          setErrorMessage(
            'Ce chapitre est en anglais. Cliquez sur « Traduire ce chapitre en français » ou activez la traduction auto pour l’écouter en français.'
          );
          return null;
        }
        return translateChapter(chapterIndex);
      }

      if (chapter.translationStatus === 'translating') {
        return translateChapter(chapterIndex);
      }

      return chapter;
    },
    [translateChapter]
  );

  const audio = useWalkmanAudio({
    session,
    activeChapterIndex,
    neuralVoiceId,
    speed,
    pitchSemitones,
    pauseDurationSeconds,
    volume,
    muted,
    onChapterIndexChange: (nextIdx) => {
      setActiveChapterIndex(nextIdx);
    },
    onBeforePlayChapter: handleBeforePlayChapter,
    onError: (msg) => {
      setErrorMessage(msg);
    },
  });

  // Apply restored stop position (chapter + segment) or autoplay after a book session mounts
  useEffect(() => {
    if (!session || session.chapters.length === 0) return;

    const pendingRestore = pendingRestorePositionRef.current;
    if (pendingRestore && pendingRestore.bookId === session.id) {
      pendingRestorePositionRef.current = null;
      audio.jumpToLocation(
        pendingRestore.chapterIndex,
        pendingRestore.segmentIndex,
        pendingRestore.autoPlay
      );
      return;
    }

    if (pendingAutoPlayRef.current) {
      pendingAutoPlayRef.current = false;
      void audio.play(0, 0);
    }
  }, [audio, session]);

  // Continuously persist active book text, bookmarks, and automatic stop position in browser IndexedDB (never MP3s)
  useEffect(() => {
    if (!hasHydratedStorageRef.current || !session) return;
    if (session.totalChars > MAX_AUTO_SAVED_DOCUMENT_CHARS) return;
    if (
      pendingRestorePositionRef.current &&
      pendingRestorePositionRef.current.bookId === session.id
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      const existing = savedBooksRef.current.find((b) => b.id === session.id);
      const record = createSavedBookRecord({
        session,
        bookmarks,
        chapterIndex: activeChapterIndex,
        segmentIndex: audio.activeSegmentIndex,
        existingSavedAt: existing?.savedAt,
      });

      void (async () => {
        try {
          await saveBookRecord(record);
          await setLastActiveBookId(session.id);

          const nextBooks = [
            record,
            ...savedBooksRef.current.filter((b) => b.id !== record.id),
          ].sort((a, b) => b.updatedAt - a.updatedAt);

          savedBooksRef.current = nextBooks;
          setSavedBooks(nextBooks);

          const nextMetrics = await measureBrowserStorage(nextBooks);
          setStorageMetrics(nextMetrics);
        } catch {
          // Storage quota exceeded or unavailable; keep running smoothly in RAM
        }
      })();
    }, 80);

    return () => window.clearTimeout(timer);
  }, [session, bookmarks, activeChapterIndex, audio.activeSegmentIndex]);

  const activeChapter = session?.chapters[activeChapterIndex] ?? null;
  const activeSavedBook = session
    ? savedBooks.find((b) => b.id === session.id) ?? null
    : null;

  // Prefetch the next English chapter when auto-translate is active
  // so flipping to the next chapter or listening continuously is instant
  useEffect(() => {
    if (!session || !autoTranslateToFrench || translationProgress) return;
    if (!activeChapter || activeChapter.translationStatus !== 'translated') return;
    const nextIdx = activeChapterIndex + 1;
    const nextChapter = session.chapters[nextIdx];
    if (nextChapter && nextChapter.translationStatus === 'needs_translation') {
      void translateChapter(nextIdx).catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setErrorMessage(
          err instanceof Error
            ? err.message
            : `Impossible de traduire le chapitre ${nextIdx + 1} en français.`
        );
      });
    }
  }, [
    session,
    activeChapter,
    activeChapterIndex,
    autoTranslateToFrench,
    translationProgress,
    translateChapter,
  ]);

  const isCurrentSegmentBookmarked = Boolean(
    activeChapter &&
      findDuplicateBookmark(bookmarks, activeChapterIndex, audio.activeSegmentIndex)
  );

  const mountNewSession = useCallback(
    (nextSession: BookSession, autoPlay: boolean) => {
      translationAbortRef.current?.abort();
      translationAbortRef.current = null;
      inflightTranslationsRef.current.clear();
      setTranslationProgress(null);
      setBookmarks([]);
      setActiveChapterIndex(0);
      sessionRef.current = nextSession;
      pendingAutoPlayRef.current = autoPlay;
      setSession(nextSession);

      // In auto-translate mode, immediately translate Chapter 1 when opening an English document
      // (if autoPlay is true, handleBeforePlayChapter will drive it seamlessly)
      if (!autoPlay && nextSession.detectedLanguage === 'en' && autoTranslateRef.current) {
        void translateChapter(0).catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setErrorMessage(
            err instanceof Error
              ? err.message
              : 'Impossible de traduire automatiquement le premier chapitre.'
          );
        });
      }
    },
    [translateChapter]
  );

  const handleImportFile = async (file: File) => {
    setErrorMessage(null);
    setExportSuccessMessage(null);
    setIsImportingFile(true);
    setImportStatusLabel(`Lecture de ${file.name}…`);

    try {
      const nextSession = await importDocumentFile(file, (label) => {
        setImportStatusLabel(label);
      });
      setDraftTitle(nextSession.title);
      const fullPreview =
        nextSession.totalChars > 60000
          ? nextSession.chapters[0]?.sourceText ?? ''
          : nextSession.chapters.map((c) => `${c.sourceTitle}\n\n${c.sourceText}`).join('\n\n');
      setDraftText(fullPreview);
      mountNewSession(nextSession, false);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Impossible d'importer ce fichier."
      );
    } finally {
      setIsImportingFile(false);
      setImportStatusLabel(null);
    }
  };

  const handleLoadPastedText = (autoPlay: boolean) => {
    const cleaned = draftText.trim();
    if (!cleaned) {
      setErrorMessage('Importez un fichier PDF/EPUB/TXT ou collez un texte français ou anglais.');
      return;
    }
    const sizeError = getDocumentTextSizeError(cleaned.length);
    if (sizeError) {
      setErrorMessage(sizeError);
      return;
    }

    setErrorMessage(null);
    setExportSuccessMessage(null);

    const inferredTitle =
      draftTitle.trim() ||
      cleaned
        .split(/\n/)[0]
        .slice(0, 56)
        .trim() ||
      'Texte collé';

    const chapters = buildChaptersFromRawText(cleaned, inferredTitle);
    const nextSession = createBookSession({
      title: inferredTitle,
      source: 'paste',
      chapters,
    });

    mountNewSession(nextSession, autoPlay);
  };

  const handleLoadSample = (sample: SampleScript) => {
    setErrorMessage(null);
    setExportSuccessMessage(null);
    setDraftTitle(sample.title);
    setDraftText(sample.text);

    const chapters = buildChaptersFromRawText(sample.text, sample.title);
    const nextSession = createBookSession({
      title: sample.title,
      source: 'paste',
      chapters,
      detectedLanguage: sample.language,
    });
    mountNewSession(nextSession, false);
  };

  const handleTranslateSingleChapter = async (chapterIndex: number) => {
    const currentSession = sessionRef.current;
    const ch = currentSession?.chapters[chapterIndex];
    if (!currentSession || !ch) return;
    if (ch.translationStatus !== 'needs_translation') return;

    setErrorMessage(null);

    try {
      await translateChapter(chapterIndex);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setErrorMessage(
        err instanceof Error ? err.message : 'Erreur lors de la traduction du chapitre.'
      );
    }
  };

  const handleTranslateAllChapters = async () => {
    const currentSession = sessionRef.current;
    if (!currentSession) return;

    const pendingIndices = currentSession.chapters
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => ch.translationStatus === 'needs_translation')
      .map(({ idx }) => idx);

    if (pendingIndices.length === 0) return;

    translationAbortRef.current?.abort();
    const ac = new AbortController();
    translationAbortRef.current = ac;

    setErrorMessage(null);
    setTranslationProgress({
      completedChapters: 0,
      totalChapters: pendingIndices.length,
      currentLabel: `Traduction du chapitre ${pendingIndices[0] + 1}…`,
    });

    let completed = 0;
    try {
      for (const chIdx of pendingIndices) {
        if (ac.signal.aborted) {
          throw new DOMException('Traduction annulée', 'AbortError');
        }
        setTranslationProgress({
          completedChapters: completed,
          totalChapters: pendingIndices.length,
          currentLabel: `Traduction en français — Chapitre ${chIdx + 1} / ${currentSession.chapters.length}`,
        });
        await translateChapter(chIdx, ac.signal);
        completed++;
      }
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Erreur lors de la traduction complète du livre.'
        );
      }
    } finally {
      translationAbortRef.current = null;
      setTranslationProgress(null);
    }
  };

  const handleSelectChapter = (chapterIndex: number, autoPlay: boolean) => {
    const currentSession = sessionRef.current;
    if (!currentSession || chapterIndex < 0 || chapterIndex >= currentSession.chapters.length) {
      return;
    }
    setErrorMessage(null);
    setActiveChapterIndex(chapterIndex);

    if (autoPlay) {
      void audio.play(chapterIndex, 0);
    } else {
      audio.stop();
      const target = currentSession.chapters[chapterIndex];
      if (target?.translationStatus === 'needs_translation' && autoTranslateRef.current) {
        void translateChapter(chapterIndex).catch((err) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          setErrorMessage(
            err instanceof Error ? err.message : 'Impossible de traduire ce chapitre en français.'
          );
        });
      }
    }
  };

  const handleAddBookmark = (note = '') => {
    if (!session || !activeChapter) return;
    if (activeChapter.translationStatus === 'needs_translation') return;

    const segIdx = Math.max(
      0,
      Math.min(audio.activeSegmentIndex, Math.max(0, activeChapter.segments.length - 1))
    );
    const segmentText = activeChapter.segments[segIdx] ?? activeChapter.text;

    setBookmarks((prev) => {
      const existing = findDuplicateBookmark(prev, activeChapterIndex, segIdx);
      if (existing) {
        if (!note.trim()) return prev;
        return prev.map((bm) =>
          bm.id === existing.id ? { ...bm, note: note.trim() } : bm
        );
      }

      const nextBookmark: BookmarkItem = {
        id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        chapterId: activeChapter.id,
        chapterIndex: activeChapterIndex,
        chapterTitle: activeChapter.title,
        segmentIndex: segIdx,
        totalSegments: activeChapter.segments.length,
        excerpt: buildBookmarkExcerpt(segmentText),
        note: note.trim(),
        createdAt: Date.now(),
      };

      return sortBookmarks([...prev, nextBookmark]);
    });
  };

  const handleJumpToBookmark = (bookmark: BookmarkItem, autoPlay: boolean) => {
    if (!session) return;
    setErrorMessage(null);
    audio.jumpToLocation(bookmark.chapterIndex, bookmark.segmentIndex, autoPlay);
    document.getElementById('liseuse')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleUpdateBookmarkNote = (bookmarkId: string, note: string) => {
    setBookmarks((prev) =>
      prev.map((bm) => (bm.id === bookmarkId ? { ...bm, note } : bm))
    );
  };

  const handleDeleteBookmark = (bookmarkId: string) => {
    setBookmarks((prev) => prev.filter((bm) => bm.id !== bookmarkId));
  };

  const handleResumeBook = (book: SavedBookRecord, autoPlay: boolean) => {
    setErrorMessage(null);
    setExportSuccessMessage(null);

    if (sessionRef.current?.id === book.id) {
      audio.jumpToLocation(
        book.lastPosition.chapterIndex,
        book.lastPosition.segmentIndex,
        autoPlay
      );
      document
        .getElementById(autoPlay ? 'lecteur' : 'liseuse')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    inflightTranslationsRef.current.clear();
    setTranslationProgress(null);

    pendingRestorePositionRef.current = {
      bookId: book.id,
      chapterIndex: book.lastPosition.chapterIndex,
      segmentIndex: book.lastPosition.segmentIndex,
      autoPlay,
    };

    sessionRef.current = book.session;
    setSession(book.session);
    setBookmarks(book.bookmarks);
    setActiveChapterIndex(book.lastPosition.chapterIndex);
    setDraftTitle(book.session.title);
    setDraftText(buildDraftPreview(book.session));
    void setLastActiveBookId(book.id);

    document
      .getElementById(autoPlay ? 'lecteur' : 'liseuse')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleResumeCurrentSavedPosition = (autoPlay: boolean) => {
    if (!session || !activeSavedBook) return;
    setErrorMessage(null);
    audio.jumpToLocation(
      activeSavedBook.lastPosition.chapterIndex,
      activeSavedBook.lastPosition.segmentIndex,
      autoPlay
    );
    document
      .getElementById(autoPlay ? 'lecteur' : 'liseuse')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteSavedBook = async (bookId: string) => {
    try {
      await deleteSavedBook(bookId);
    } catch {
      // Proceed with local state cleanup even if IndexedDB fails
    }

    const remaining = savedBooksRef.current.filter((b) => b.id !== bookId);
    savedBooksRef.current = remaining;
    setSavedBooks(remaining);

    if (sessionRef.current?.id === bookId) {
      exportAbortRef.current?.abort();
      exportAbortRef.current = null;
      translationAbortRef.current?.abort();
      translationAbortRef.current = null;
      inflightTranslationsRef.current.clear();
      audio.clearAudioMemory();
      setTranslationProgress(null);
      setExportProgress(null);
      replaceReadyMp3(null);

      if (remaining.length > 0) {
        const nextBook = remaining[0];
        pendingRestorePositionRef.current = {
          bookId: nextBook.id,
          chapterIndex: nextBook.lastPosition.chapterIndex,
          segmentIndex: nextBook.lastPosition.segmentIndex,
          autoPlay: false,
        };
        sessionRef.current = nextBook.session;
        setSession(nextBook.session);
        setBookmarks(nextBook.bookmarks);
        setActiveChapterIndex(nextBook.lastPosition.chapterIndex);
        setDraftTitle(nextBook.session.title);
        setDraftText(buildDraftPreview(nextBook.session));
        void setLastActiveBookId(nextBook.id);
      } else {
        sessionRef.current = null;
        setSession(null);
        setBookmarks([]);
        setActiveChapterIndex(0);
        setDraftTitle('');
        setDraftText('');
        void setLastActiveBookId(null);
      }
    }

    const nextMetrics = await measureBrowserStorage(remaining);
    setStorageMetrics(nextMetrics);
  };

  const handleClearAllStorage = async () => {
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    inflightTranslationsRef.current.clear();
    pendingRestorePositionRef.current = null;
    audio.clearAudioMemory();
    sessionRef.current = null;
    setSession(null);
    setBookmarks([]);
    setActiveChapterIndex(0);
    setDraftTitle('');
    setDraftText('');
    setErrorMessage(null);
    setTranslationProgress(null);
    setExportProgress(null);
    setExportSuccessMessage(null);
    setExportErrorMessage(null);
    replaceReadyMp3(null);

    try {
      await clearAllSavedBooks();
    } catch {
      // Ignore if IndexedDB is already empty
    }

    savedBooksRef.current = [];
    setSavedBooks([]);
    const nextMetrics = await measureBrowserStorage([]);
    setStorageMetrics(nextMetrics);
  };

  const runIncrementalMp3Export = async (scope: 'chapter' | 'book', targetChapterIdx?: number) => {
    let currentSession = sessionRef.current;

    // Allow 1-click MP3 export directly from pasted text without forcing an intermediate step
    if (!currentSession && draftText.trim()) {
      const cleaned = draftText.trim();
      const sizeError = getDocumentTextSizeError(cleaned.length);
      if (sizeError) {
        setExportErrorMessage(sizeError);
        return;
      }
      const inferredTitle =
        draftTitle.trim() ||
        cleaned.split(/\n/)[0].slice(0, 56).trim() ||
        'Texte collé';
      const chapters = buildChaptersFromRawText(cleaned, inferredTitle);
      const created = createBookSession({
        title: inferredTitle,
        source: 'paste',
        chapters,
      });
      sessionRef.current = created;
      setSession(created);
      setActiveChapterIndex(0);
      currentSession = created;
    }

    if (!currentSession) {
      setExportErrorMessage('Importez un document ou collez un texte avant d’exporter en MP3.');
      return;
    }

    const indicesToExport =
      scope === 'chapter'
        ? [targetChapterIdx ?? activeChapterIndex].filter(
            (i) => i >= 0 && i < currentSession.chapters.length
          )
        : currentSession.chapters.map((_, i) => i);

    if (indicesToExport.length === 0) return;

    const ac = new AbortController();
    exportAbortRef.current = ac;

    setErrorMessage(null);
    setExportSuccessMessage(null);
    setExportErrorMessage(null);
    replaceReadyMp3(null);

    const voiceLabel = getNeuralVoiceById(neuralVoiceId).name;

    try {
      // Step 1/3: Prepare & translate untranslated or currently-translating English chapters
      const chaptersNeedingTranslation = indicesToExport.filter((chIdx) => {
        const ch = sessionRef.current?.chapters[chIdx];
        return Boolean(
          ch &&
            (ch.translationStatus === 'needs_translation' ||
              ch.translationStatus === 'translating') &&
            autoTranslateRef.current
        );
      });

      const preparedChapters: ChapterItem[] = [];
      let translatedCount = 0;

      if (chaptersNeedingTranslation.length === 0) {
        setExportProgress({
          scope,
          stage: 'preparing',
          stageHeadline: 'Étape 1/3 · Préparation du texte français',
          detail: 'Vérification des chapitres et découpage avant synthèse vocale…',
          label: 'Préparation du texte…',
          completedSegments: 0,
          totalSegments: Math.max(1, indicesToExport.length),
          stepIndex: 1,
          totalSteps: 3,
        });
      }

      for (let i = 0; i < indicesToExport.length; i++) {
        if (ac.signal.aborted) {
          throw new DOMException('Export annulé', 'AbortError');
        }
        const chIdx = indicesToExport[i];
        let chapter = sessionRef.current?.chapters[chIdx];
        if (!chapter) continue;

        if (
          (chapter.translationStatus === 'needs_translation' ||
            chapter.translationStatus === 'translating') &&
          autoTranslateRef.current
        ) {
          setExportProgress({
            scope,
            stage: 'translating',
            stageHeadline: 'Étape 1/3 · Traduction EN → FR',
            detail: `Traduction du chapitre ${chIdx + 1}/${currentSession.chapters.length} (« ${chapter.sourceTitle} »)…`,
            label: `Traduction EN → FR — Chapitre ${chIdx + 1}`,
            completedSegments: translatedCount,
            totalSegments: Math.max(1, chaptersNeedingTranslation.length),
            stepIndex: 1,
            totalSteps: 3,
          });
          const translated = await translateChapter(chIdx, ac.signal);
          if (translated) {
            chapter = translated;
          }
          translatedCount++;
        }
        preparedChapters.push(chapter);
      }

      const totalSegments = preparedChapters.reduce((sum, ch) => sum + ch.segments.length, 0);
      const isDefaultTuning = Math.abs(speed - 1.0) < 0.01 && Math.abs(pitchSemitones) < 0.05;
      const canFastConcatNeuralMp3 = isDefaultTuning && pauseDurationSeconds === 0;

      setExportProgress({
        scope,
        stage: 'synthesizing',
        stageHeadline: `Étape 2/3 · Synthèse vocale (voix ${voiceLabel})`,
        detail:
          scope === 'chapter'
            ? `Génération vocale — ${preparedChapters[0].title}`
            : `Génération vocale du livre entier (${preparedChapters.length} chapitres)…`,
        label: `Synthèse vocale (${voiceLabel})`,
        completedSegments: 0,
        totalSegments,
        stepIndex: 2,
        totalSteps: 3,
      });

      const directMp3Chunks: Uint8Array[] = [];
      let builder: IncrementalMp3Builder | null = null;
      let sampleRate = 24000;
      let completed = 0;

      for (let chIdx = 0; chIdx < preparedChapters.length; chIdx++) {
        const chapter = preparedChapters[chIdx];
        for (let segIdx = 0; segIdx < chapter.segments.length; segIdx++) {
          if (ac.signal.aborted) {
            throw new DOMException('Export annulé', 'AbortError');
          }

          const segDetail =
            scope === 'chapter'
              ? `${chapter.title} — segment ${segIdx + 1}/${chapter.segments.length}`
              : `Chapitre ${chIdx + 1}/${preparedChapters.length} (${chapter.title}) — segment ${segIdx + 1}/${chapter.segments.length}`;

          setExportProgress({
            scope,
            stage: 'synthesizing',
            stageHeadline: `Étape 2/3 · Synthèse vocale (voix ${voiceLabel})`,
            detail: `Génération vocale · ${segDetail}`,
            label: segDetail,
            completedSegments: completed,
            totalSegments,
            stepIndex: 2,
            totalSteps: 3,
          });

          const segAudio = await audio.fetchSegmentAudio(chapter, segIdx, ac.signal);

          if (canFastConcatNeuralMp3 && segAudio.mimeType === 'audio/mpeg') {
            directMp3Chunks.push(new Uint8Array(segAudio.rawBytes));
          } else {
            setExportProgress({
              scope,
              stage: 'encoding',
              stageHeadline: 'Étape 2/3 · Encodage MP3 & réglage audio',
              detail: `Conversion MP3 128 kbps · ${segDetail}`,
              label: `Encodage MP3 — ${segDetail}`,
              completedSegments: completed,
              totalSegments,
              stepIndex: 2,
              totalSteps: 3,
            });

            const decoded = await audio.decodeAudioToMonoPcm(segAudio);
            sampleRate = decoded.sampleRate;

            if (!builder) {
              builder = new IncrementalMp3Builder(sampleRate, 128);
            }

            const shaped = processAudioSpeedPitch(
              decoded.samples,
              sampleRate,
              speed,
              pitchSemitones
            );
            const shapedWithPauses = insertSilenceAtOffsets(
              shaped,
              decoded.samples.length,
              decoded.pauseOffsets,
              sampleRate,
              pauseDurationSeconds,
              segIdx + 1 < chapter.segments.length
            );
            builder.appendSamples(shapedWithPauses, sampleRate);
          }

          completed++;
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        if (builder && chIdx < preparedChapters.length - 1) {
          builder.appendSilence(0.7);
        }
      }

      const baseName =
        scope === 'chapter'
          ? `${currentSession.title}-${preparedChapters[0].title}`
          : `${currentSession.title}-integral`;
      const filename = sanitizeMp3Filename(baseName);

      // Step 3/3: Package final MP3 file in RAM (never persisted in browser storage)
      setExportProgress({
        scope,
        stage: 'packaging',
        stageHeadline: 'Étape 3/3 · Assemblage du fichier MP3',
        detail: `Finalisation de ${filename} en mémoire (non stocké dans le navigateur)…`,
        label: 'Assemblage du fichier MP3…',
        completedSegments: totalSegments,
        totalSegments,
        stepIndex: 3,
        totalSteps: 3,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));

      let mp3Bytes: Uint8Array;
      if (canFastConcatNeuralMp3 && directMp3Chunks.length > 0 && !builder) {
        const totalLen = directMp3Chunks.reduce((sum, c) => sum + c.length, 0);
        mp3Bytes = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of directMp3Chunks) {
          mp3Bytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (builder) {
        mp3Bytes = builder.finalize();
      } else {
        throw new Error('Aucun audio généré pour cet export.');
      }

      const objectUrl = createMp3ObjectUrl(mp3Bytes);

      replaceReadyMp3({
        url: objectUrl,
        filename,
        sizeBytes: mp3Bytes.byteLength,
        createdAt: Date.now(),
      });
      setExportSuccessMessage(`Fichier ${filename} prêt.`);

      // Attempt automatic download immediately, while keeping the direct <a download> button ready
      try {
        triggerDownloadFromObjectUrl(objectUrl, filename);
      } catch {
        // Fallback: user can click the visible "Télécharger le MP3" button directly
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        setExportSuccessMessage('Export MP3 annulé.');
      } else {
        const typed = err as Error & { isQuota?: boolean };
        const msg = typed.message || "Erreur lors de l'encodage MP3.";
        setErrorMessage(msg);
        setExportErrorMessage(msg);
      }
    } finally {
      exportAbortRef.current = null;
      setExportProgress(null);
    }
  };

  const isActiveChapterTranslating =
    activeChapter?.translationStatus === 'translating' || Boolean(translationProgress);

  const handleDownloadVoiceModel = async () => {
    if (!supportsVoiceModelStorage()) {
      setVoiceModelStatus('unsupported');
      setVoiceDownloadMessage(
        'Le stockage des modèles vocaux exige une origine sécurisée. Ouvrez cette application sur le même ordinateur via http://localhost:3000/sonobande/ ou utilisez la version HTTPS.'
      );
      return;
    }

    setVoiceModelStatus('downloading');
    setVoiceDownloadPercent(0);
    setVoiceDownloadMessage('Préparation du téléchargement…');

    try {
      await vits.download(neuralVoiceId, (progress) => {
        const percent =
          progress.total > 0 ? Math.round((progress.loaded / progress.total) * 100) : 0;
        setVoiceDownloadPercent(percent);
        setVoiceDownloadMessage(
          percent > 0 ? `Téléchargement de la voix : ${percent}%` : 'Téléchargement de la voix…'
        );
      });

      const isCached = await waitForVoiceModelCache(neuralVoiceId);
      if (isCached) {
        window.localStorage.setItem(`sonobande:voice:${neuralVoiceId}:installed`, 'true');
        setVoiceModelStatus('ready');
        setShowVoiceDownload(false);
        setVoiceDownloadPercent(100);
        setErrorMessage(null);
      } else {
        setVoiceModelStatus('error');
        setVoiceDownloadMessage(
          'Le modèle a été téléchargé mais les fichiers n’ont pas pu être vérifiés dans le stockage du navigateur.'
        );
      }
    } catch (error) {
      setVoiceModelStatus('error');
      setVoiceDownloadMessage(
        error instanceof Error ? error.message : 'Impossible de télécharger la voix.'
      );
    }
  };

  return (
    <div className="min-h-screen bg-[#ece9e2] text-[#1c1e21]">
      {showVoiceDownload && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#1c1e21]/55 px-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="voice-download-title"
            className="w-full max-w-md rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-6 shadow-xl"
          >
            <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#b93e0e]">
              Première utilisation
            </p>
            <h2 id="voice-download-title" className="mt-1 font-display text-xl font-bold">
              Télécharger {getNeuralVoiceById(neuralVoiceId).name}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#55585e]">
              {voiceModelStatus === 'unsupported'
                ? 'Cette adresse HTTP ne permet pas au navigateur d’enregistrer le modèle vocal.'
                : <>Le modèle Piper <span className="font-mono">fr_FR-siwis-medium</span> sera enregistré dans le stockage privé de votre navigateur. Il pourra ensuite être utilisé hors ligne.</>}
            </p>

            {voiceModelStatus === 'downloading' ? (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs text-[#55585e]">
                  <span>{voiceDownloadMessage}</span>
                  <span className="font-mono tabular-nums">{voiceDownloadPercent}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#ddd8cc]">
                  <div
                    className="h-full rounded-full bg-[#d9531e] transition-[width]"
                    style={{ width: `${voiceDownloadPercent}%` }}
                  />
                </div>
              </div>
            ) : voiceModelStatus !== 'unsupported' ? (
              <button
                type="button"
                onClick={() => void handleDownloadVoiceModel()}
                className="mt-5 w-full rounded-lg bg-[#d9531e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c24515]"
              >
                Télécharger le modèle vocal
              </button>
            ) : null}

            {(voiceModelStatus === 'error' || voiceModelStatus === 'unsupported') &&
              voiceDownloadMessage && (
              <p className="mt-3 rounded-lg border border-[#d49a89] bg-[#fbefeb] px-3 py-2 text-xs text-[#8a280b]">
                {voiceDownloadMessage}
              </p>
            )}

            {voiceModelStatus !== 'downloading' && (
              <button
                type="button"
                onClick={() => setShowVoiceDownload(false)}
                className="mt-3 w-full rounded-lg border border-[#cfc9bd] bg-white px-4 py-2 text-xs font-medium text-[#25272b] hover:bg-[#f0ede5]"
              >
                Plus tard
              </button>
            )}
          </div>
        </div>
      )}

      <TopBar
        storageMetrics={storageMetrics}
        hasAnyData={Boolean(savedBooks.length > 0 || session || draftText.trim())}
        onClearAllStorage={handleClearAllStorage}
      />

      <WalkmanQuickControls
        hasBook={Boolean(session && activeChapter)}
        isPlaying={audio.transportState === 'playing'}
        isBuffering={audio.transportState === 'buffering'}
        isExporting={Boolean(exportProgress)}
        canGoPrevious={activeChapterIndex > 0}
        canGoNext={activeChapterIndex < (session?.chapters.length ?? 0) - 1}
        onPlay={() => void audio.play()}
        onPause={audio.pause}
        onStop={audio.stop}
        onRewind={audio.rewind}
        onFastForward={audio.fastForward}
        onPrevChapter={() => handleSelectChapter(activeChapterIndex - 1, true)}
        onNextChapter={() => handleSelectChapter(activeChapterIndex + 1, true)}
      />

      <main className="mx-auto max-w-[1280px] space-y-6 px-4 pt-5 pb-28 sm:px-6 sm:pt-7 md:space-y-8 md:px-8 md:pt-9 md:pb-9 md:pr-20">
        <div className="grid grid-cols-1 items-stretch gap-5 sm:gap-7 lg:grid-cols-12">
          <div className="order-2 min-w-0 lg:order-1 lg:col-span-6 xl:col-span-5">
            <WalkmanDeck
              session={session}
              activeChapter={activeChapter}
              activeChapterIndex={activeChapterIndex}
              neuralVoiceId={neuralVoiceId}
              transportState={audio.transportState}
              activeSegmentIndex={audio.activeSegmentIndex}
              totalSegmentsInChapter={audio.totalSegmentsInChapter}
              segmentCurrentTime={audio.segmentCurrentTime}
              segmentDuration={audio.segmentDuration}
              chapterProgressRatio={audio.chapterProgressRatio}
              vuLevel={audio.vuLevel}
              speed={speed}
              pitchSemitones={pitchSemitones}
              pauseDurationSeconds={pauseDurationSeconds}
              volume={volume}
              muted={muted}
              exportProgress={exportProgress}
              exportSuccessMessage={exportSuccessMessage}
              exportErrorMessage={exportErrorMessage}
              readyMp3={readyMp3}
              hasDraftText={draftText.trim().length > 0}
              isTranslating={isActiveChapterTranslating}
              isCurrentSegmentBookmarked={isCurrentSegmentBookmarked}
              onPlay={() => void audio.play()}
              onPause={audio.pause}
              onStop={audio.stop}
              onRewind={audio.rewind}
              onFastForward={audio.fastForward}
              onPrevChapter={() => handleSelectChapter(activeChapterIndex - 1, true)}
              onNextChapter={() => handleSelectChapter(activeChapterIndex + 1, true)}
              onSeekSegment={audio.seekSegment}
              onSpeedChange={(s) => setSpeed(Math.round(s * 100) / 100)}
              onPitchChange={(p) => setPitchSemitones(Math.round(p * 10) / 10)}
              onPauseDurationChange={setPauseDurationSeconds}
              onResetTuning={() => {
                setSpeed(1.0);
                setPitchSemitones(0);
                setPauseDurationSeconds(DEFAULT_PAUSE_DURATION_SECONDS);
              }}
              onVolumeChange={(v) => {
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              onToggleMute={() => setMuted((m) => !m)}
              onAddBookmark={() => handleAddBookmark()}
              onExportChapterMp3={() => void runIncrementalMp3Export('chapter')}
              onExportBookMp3={() => void runIncrementalMp3Export('book')}
              onCancelExport={() => exportAbortRef.current?.abort()}
              onDismissReadyMp3={() => replaceReadyMp3(null)}
            />
          </div>

          <div className="order-1 min-w-0 lg:order-2 lg:col-span-6 xl:col-span-7">
            <TextStudio
              session={session}
              neuralVoiceId={neuralVoiceId}
              draftTitle={draftTitle}
              draftText={draftText}
              speed={speed}
              isImportingFile={isImportingFile}
              importStatusLabel={importStatusLabel}
              autoTranslateToFrench={autoTranslateToFrench}
              translationProgress={translationProgress}
              browserTranslationStatus={browserTranslationStatus}
              errorMessage={errorMessage}
              onDraftTitleChange={setDraftTitle}
              onDraftTextChange={(val) => {
                setDraftText(val);
                if (errorMessage && val.trim()) setErrorMessage(null);
              }}
              onImportFile={(file) => void handleImportFile(file)}
              onLoadPastedText={handleLoadPastedText}
              onLoadSample={handleLoadSample}
              onToggleAutoTranslate={() => setAutoTranslateToFrench((prev) => !prev)}
              onTranslateAllChapters={() => void handleTranslateAllChapters()}
              onCancelTranslation={() => translationAbortRef.current?.abort()}
              onClearDraft={() => {
                setDraftText('');
                setDraftTitle('');
                setErrorMessage(null);
              }}
            />
          </div>
        </div>

        {/* Browser Text-Only Book Library with Auto Stop-Position Resume */}
        <BookLibrary
          books={savedBooks}
          activeBookId={session?.id ?? null}
          onResumeBook={handleResumeBook}
          onDeleteBook={(id) => void handleDeleteSavedBook(id)}
        />

        {/* Synchronized French-only Chapter Reader */}
        <ChapterReader
          session={session}
          activeChapter={activeChapter}
          activeChapterIndex={activeChapterIndex}
          activeSegmentIndex={audio.activeSegmentIndex}
          isPlaying={audio.transportState === 'playing'}
          autoTranslateToFrench={autoTranslateToFrench}
          bookmarks={bookmarks}
          onTranslateChapter={(idx) => void handleTranslateSingleChapter(idx)}
          onSelectSegment={(segIdx, autoPlay) => audio.jumpToSegment(segIdx, autoPlay)}
          onAddBookmark={(note) => handleAddBookmark(note)}
          onPrevChapter={() => handleSelectChapter(activeChapterIndex - 1, false)}
          onNextChapter={() => handleSelectChapter(activeChapterIndex + 1, false)}
        />

        {/* Chapters & Bookmarks Tabs (including auto-saved stop position) */}
        <ChapterList
          session={session}
          activeChapterIndex={activeChapterIndex}
          activeSegmentIndex={audio.activeSegmentIndex}
          isPlaying={audio.transportState === 'playing'}
          isExporting={Boolean(exportProgress)}
          exportProgress={exportProgress}
          readyMp3={readyMp3}
          exportErrorMessage={exportErrorMessage}
          savedPosition={activeSavedBook?.lastPosition ?? null}
          bookmarks={bookmarks}
          onSelectChapter={handleSelectChapter}
          onTranslateChapter={(idx) => void handleTranslateSingleChapter(idx)}
          onExportChapterMp3={(idx) => void runIncrementalMp3Export('chapter', idx)}
          onExportBookMp3={() => void runIncrementalMp3Export('book')}
          onCancelExport={() => exportAbortRef.current?.abort()}
          onDismissReadyMp3={() => replaceReadyMp3(null)}
          onResumeSavedPosition={handleResumeCurrentSavedPosition}
          onJumpToBookmark={handleJumpToBookmark}
          onUpdateBookmarkNote={handleUpdateBookmarkNote}
          onDeleteBookmark={handleDeleteBookmark}
        />
      </main>

      <footer className="mx-auto max-w-[1280px] border-t border-[#d8d3c8] pl-4 pr-[4.5rem] py-6 text-xs text-[#64676d] sm:pl-8 sm:pr-20">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Sonobande — Lecteur Walkman · Bibliothèque locale (texte seul) · Traduction EN → FR
          </span>
          <span>Livres & reprise stockés dans le navigateur · MP3 jamais stockés</span>
        </div>
      </footer>
    </div>
  );
}
