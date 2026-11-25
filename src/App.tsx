import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookLibrary } from './components/BookLibrary';
import { ChapterList } from './components/ChapterList';
import { ChapterReader } from './components/ChapterReader';
import { FullscreenListeningView } from './components/FullscreenListeningView';
import { GlobalProgressBar } from './components/GlobalProgressBar';
import { TextStudio } from './components/TextStudio';
import { TopBar } from './components/TopBar';
import { WalkmanDeck } from './components/WalkmanDeck';
import { WalkmanQuickControls } from './components/WalkmanQuickControls';
import {
  getNeuralVoiceById,
  NEURAL_FRENCH_VOICES,
} from './constants/voices';
import { useWalkmanAudio } from './hooks/useWalkmanAudio';
import type {
  BookmarkItem,
  BookSession,
  BrowserStorageMetrics,
  ChapterItem,
  ExportProgress,
  GlobalTaskProgress,
  NeuralVoiceId,
  ReadyMp3Download,
  SampleScript,
  SavedBookRecord,
  TranslationProgress,
  VoiceRuntimeStatus,
} from './types/walkman';
import {
  DEFAULT_PAUSE_DURATION_SECONDS,
  enhanceVoiceHdFluid,
  parseWavBuffer,
} from './utils/audioDsp';
import {
  applyChapterTranslation,
  buildChaptersFromRawText,
  createBookSession,
  sanitizeMp3Filename,
} from './utils/bookSplitter';
import {
  clearAllSavedBooks,
  clearResumePositionSnapshot,
  createSavedBookRecord,
  deleteSavedBook,
  getLastActiveBookId,
  loadAllSavedBooks,
  loadResumePositionSnapshot,
  measureBrowserStorage,
  saveBookRecord,
  saveResumePositionSnapshot,
  setLastActiveBookId,
} from './utils/bookStorage';
import { createBrowserMp3Session, type BrowserMp3Session } from './utils/browserMp3';
import { synthesizeInBrowser } from './utils/browserVoice';
import {
  importDocumentFile,
  type DocumentImportProgress,
} from './utils/documentParser';
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
  triggerDownloadFromObjectUrl,
} from './utils/mp3Encoder';
import { translateInBrowser } from './utils/browserTranslation';
import { purgeLegacyLocalData } from './utils/privacyCleanup';
import {
  clearVoiceHealthEntry,
  downloadVoiceModel,
  inspectAllCachedVoices,
  readVoiceHealthMap,
  readVoiceListeningSettings,
  removeVoiceModel,
  supportsVoiceModelStorage,
  writeVoiceHealthEntry,
  writeVoiceListeningSettings,
} from './utils/voiceStorage';

const EXPORT_STEPS = [
  { id: 1, label: 'Traduction' },
  { id: 2, label: 'Voix & Audio' },
  { id: 3, label: 'Fichier MP3' },
];

const INITIAL_STORAGE_METRICS: BrowserStorageMetrics = {
  booksCount: 0,
  libraryTextBytes: 0,
  browserUsageBytes: null,
  browserQuotaBytes: null,
  remainingBytes: null,
  percentUsed: null,
};

const FULLSCREEN_STORAGE_KEY = 'sonobande:fullscreen-listening';

function createInitialVoiceStatuses(): Record<NeuralVoiceId, VoiceRuntimeStatus> {
  const savedHealth = readVoiceHealthMap();
  return Object.fromEntries(
    NEURAL_FRENCH_VOICES.map((voice) => {
      const persisted = savedHealth[voice.id];
      return [
        voice.id,
        {
          installState: 'checking',
          healthState: persisted?.state ?? 'untested',
          downloadPercent: 0,
          sizeBytes: null,
          errorMessage: persisted?.state === 'failed' ? persisted.errorMessage : null,
        } satisfies VoiceRuntimeStatus,
      ];
    })
  ) as Record<NeuralVoiceId, VoiceRuntimeStatus>;
}

function readSavedFullscreenPreference(): boolean {
  try {
    return window.localStorage.getItem(FULLSCREEN_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeSavedFullscreenPreference(enabled: boolean): void {
  try {
    if (enabled) {
      window.localStorage.setItem(FULLSCREEN_STORAGE_KEY, 'true');
    } else {
      window.localStorage.removeItem(FULLSCREEN_STORAGE_KEY);
    }
  } catch {
    // Ignore storage restriction
  }
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

  // Restored voice & listening preferences (hydrated synchronously so reloads never lose tuning)
  const initialVoiceSettings = useMemo(() => readVoiceListeningSettings(), []);

  // Multi-voice Piper French selection, OPFS cache state & live health status
  const [neuralVoiceId, setNeuralVoiceId] = useState<NeuralVoiceId>(
    () => initialVoiceSettings.voiceId
  );
  const [voiceStatuses, setVoiceStatuses] = useState<Record<NeuralVoiceId, VoiceRuntimeStatus>>(
    () => createInitialVoiceStatuses()
  );
  const [showVoiceDownload, setShowVoiceDownload] = useState(false);

  // English -> French translation settings & progress
  const [autoTranslateToFrench, setAutoTranslateToFrench] = useState<boolean>(
    () => initialVoiceSettings.autoTranslateToFrench
  );
  const [translationProgress, setTranslationProgress] = useState<TranslationProgress | null>(null);
  const [browserTranslationStatus, setBrowserTranslationStatus] = useState<string | null>(null);

  // Listening personalization (all persisted automatically in browser storage)
  const [speed, setSpeed] = useState<number>(() => initialVoiceSettings.speed);
  const [pitchSemitones, setPitchSemitones] = useState<number>(
    () => initialVoiceSettings.pitchSemitones
  );
  const [pauseDurationSeconds, setPauseDurationSeconds] = useState<number>(
    () => initialVoiceSettings.pauseDurationSeconds
  );
  const [hdVoiceEnhanced, setHdVoiceEnhanced] = useState<boolean>(
    () => initialVoiceSettings.hdVoiceEnhanced
  );
  const [volume, setVolume] = useState<number>(() => initialVoiceSettings.volume);
  const [muted, setMuted] = useState<boolean>(() => initialVoiceSettings.muted);

  // Import, errors, fullscreen listening & MP3 export progress
  const [isFullscreenListening, setIsFullscreenListening] = useState<boolean>(() =>
    readSavedFullscreenPreference()
  );
  const [isImportingFile, setIsImportingFile] = useState(false);
  const [importProgress, setImportProgress] = useState<DocumentImportProgress | null>(null);
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
  const importAbortRef = useRef<AbortController | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const singleTranslationControllersRef = useRef<Set<AbortController>>(new Set());
  const inflightTranslationsRef = useRef<Map<string, Promise<ChapterItem>>>(new Map());
  const pendingAutoPlayRef = useRef<boolean>(false);
  const hasHydratedStorageRef = useRef<boolean>(false);
  const pendingRestorePositionRef = useRef<{
    bookId: string;
    chapterIndex: number;
    segmentIndex: number;
    offsetSeconds: number;
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
        const snapshot = loadResumePositionSnapshot(target.id);
        const useSnapshot = Boolean(snapshot && snapshot.updatedAt >= target.lastPosition.updatedAt);
        const restoredChapterIdx = useSnapshot
          ? Math.max(0, Math.min(snapshot!.chapterIndex, target.session.chapters.length - 1))
          : target.lastPosition.chapterIndex;
        const restoredChapter = target.session.chapters[restoredChapterIdx];
        const maxSegmentIdx = Math.max(0, (restoredChapter?.segments.length ?? 1) - 1);
        const restoredSegmentIdx = useSnapshot
          ? Math.max(0, Math.min(snapshot!.segmentIndex, maxSegmentIdx))
          : target.lastPosition.segmentIndex;
        const restoredOffsetSeconds = useSnapshot
          ? snapshot!.offsetSeconds
          : target.lastPosition.offsetSeconds ?? 0;

        pendingRestorePositionRef.current = {
          bookId: target.id,
          chapterIndex: restoredChapterIdx,
          segmentIndex: restoredSegmentIdx,
          offsetSeconds: restoredOffsetSeconds,
          autoPlay: false,
        };
        sessionRef.current = target.session;
        setSession(target.session);
        setBookmarks(target.bookmarks);
        setActiveChapterIndex(restoredChapterIdx);
      } else {
        setIsFullscreenListening(false);
      }

      hasHydratedStorageRef.current = true;
    })();

    return () => {
      cancelled = true;
      if (readyMp3UrlRef.current) {
        URL.revokeObjectURL(readyMp3UrlRef.current);
        readyMp3UrlRef.current = null;
      }
      if (previewAudioCtxRef.current && previewAudioCtxRef.current.state !== 'closed') {
        void previewAudioCtxRef.current.close().catch(() => {});
        previewAudioCtxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    writeSavedFullscreenPreference(isFullscreenListening);
  }, [isFullscreenListening]);

  // Persist every voice & listening setting immediately and on page unload so every reload restores exact state
  useEffect(() => {
    const currentSettings = {
      voiceId: neuralVoiceId,
      speed,
      pitchSemitones,
      pauseDurationSeconds,
      hdVoiceEnhanced,
      volume,
      muted,
      autoTranslateToFrench,
    };
    writeVoiceListeningSettings(currentSettings);

    const flushSettings = () => {
      writeVoiceListeningSettings(currentSettings);
    };
    window.addEventListener('pagehide', flushSettings);
    window.addEventListener('beforeunload', flushSettings);
    return () => {
      window.removeEventListener('pagehide', flushSettings);
      window.removeEventListener('beforeunload', flushSettings);
    };
  }, [
    neuralVoiceId,
    speed,
    pitchSemitones,
    pauseDurationSeconds,
    hdVoiceEnhanced,
    volume,
    muted,
    autoTranslateToFrench,
  ]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!supportsVoiceModelStorage()) {
        if (cancelled) return;
        const unsupportedMsg =
          'Le stockage des modèles vocaux exige une origine sécurisée (localhost ou HTTPS).';
        setVoiceStatuses((prev) => {
          const next = { ...prev };
          for (const voice of NEURAL_FRENCH_VOICES) {
            next[voice.id] = {
              installState: 'unsupported',
              healthState: 'failed',
              downloadPercent: 0,
              sizeBytes: null,
              errorMessage: unsupportedMsg,
            };
          }
          return next;
        });
        setShowVoiceDownload(true);
        return;
      }

      try {
        const cachedMap = await inspectAllCachedVoices();
        if (cancelled) return;

        let anyInstalled = false;
        let firstInstalledId: NeuralVoiceId | null = null;
        setVoiceStatuses((prev) => {
          const next = { ...prev };
          for (const voice of NEURAL_FRENCH_VOICES) {
            const info = cachedMap[voice.id];
            if (info?.installed) {
              anyInstalled = true;
              if (!firstInstalledId) firstInstalledId = voice.id;
            } else {
              clearVoiceHealthEntry(voice.id);
            }
            next[voice.id] = {
              ...prev[voice.id],
              installState: info?.installed ? 'installed' : 'missing',
              healthState: info?.installed ? prev[voice.id].healthState : 'untested',
              sizeBytes: info?.sizeBytes ?? null,
              downloadPercent: info?.installed ? 100 : 0,
              errorMessage:
                info?.installed && prev[voice.id].healthState === 'failed'
                  ? prev[voice.id].errorMessage
                  : null,
            };
          }
          return next;
        });

        if (!cachedMap[neuralVoiceId]?.installed && firstInstalledId) {
          setNeuralVoiceId(firstInstalledId);
        }
        if (!anyInstalled) {
          setShowVoiceDownload(true);
        }
      } catch {
        if (cancelled) return;
        setShowVoiceDownload(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Run once on startup to inspect OPFS voice cache
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      const ownController = signal ? null : new AbortController();
      const effectiveSignal = signal ?? ownController?.signal;
      if (ownController) {
        singleTranslationControllersRef.current.add(ownController);
      }

      const task = (async (): Promise<ChapterItem> => {
        const payload = await translateInBrowser(target.sourceTitle, target.sourceText, {
          signal: effectiveSignal,
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
        if (ownController) {
          singleTranslationControllersRef.current.delete(ownController);
        }
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

  const handleVoiceHealthChange = useCallback(
    (voiceId: NeuralVoiceId, state: 'working' | 'failed', errMsg?: string | null) => {
      const normalizedErr = state === 'failed' ? errMsg || 'Erreur de synthèse vocale.' : null;
      writeVoiceHealthEntry(voiceId, state, normalizedErr);
      setVoiceStatuses((prev) => {
        const current = prev[voiceId];
        if (!current) return prev;
        return {
          ...prev,
          [voiceId]: {
            ...current,
            installState: state === 'working' ? 'installed' : current.installState,
            healthState: state,
            errorMessage: normalizedErr,
          },
        };
      });
    },
    []
  );

  const audio = useWalkmanAudio({
    session,
    activeChapterIndex,
    neuralVoiceId,
    speed,
    pitchSemitones,
    pauseDurationSeconds,
    hdVoiceEnhanced,
    volume,
    muted,
    suspendVisualMeter: isFullscreenListening,
    onChapterIndexChange: (nextIdx) => {
      setActiveChapterIndex(nextIdx);
    },
    onBeforePlayChapter: handleBeforePlayChapter,
    onVoiceHealthChange: handleVoiceHealthChange,
    onError: (msg) => {
      setErrorMessage(msg);
    },
  });

  // Apply restored stop position (chapter + segment + exact second) or autoplay after a book session mounts
  useEffect(() => {
    if (!session || session.chapters.length === 0) return;

    const pendingRestore = pendingRestorePositionRef.current;
    if (pendingRestore && pendingRestore.bookId === session.id) {
      pendingRestorePositionRef.current = null;
      audio.jumpToLocation(
        pendingRestore.chapterIndex,
        pendingRestore.segmentIndex,
        pendingRestore.autoPlay,
        pendingRestore.offsetSeconds
      );
      return;
    }

    if (pendingAutoPlayRef.current) {
      pendingAutoPlayRef.current = false;
      void audio.play(0, 0);
    }
  }, [audio, session]);

  const persistedOffsetSeconds =
    audio.transportState === 'playing'
      ? Math.floor(audio.segmentCurrentTime)
      : Math.round(audio.segmentCurrentTime * 10) / 10;

  // Keep a synchronous resume snapshot in localStorage so even an abrupt reload (Cmd+R) mid-sentence
  // restores the exact chapter, segment, and second.
  useEffect(() => {
    if (!hasHydratedStorageRef.current || !session) return;
    if (
      pendingRestorePositionRef.current &&
      pendingRestorePositionRef.current.bookId === session.id
    ) {
      return;
    }

    saveResumePositionSnapshot(session.id, {
      chapterIndex: activeChapterIndex,
      segmentIndex: audio.activeSegmentIndex,
      offsetSeconds: persistedOffsetSeconds,
    });
  }, [session, activeChapterIndex, audio.activeSegmentIndex, persistedOffsetSeconds]);

  useEffect(() => {
    if (!session) return;

    const flushExactResumePosition = () => {
      if (!hasHydratedStorageRef.current || !sessionRef.current) return;
      saveResumePositionSnapshot(sessionRef.current.id, {
        chapterIndex: activeChapterIndex,
        segmentIndex: audio.activeSegmentIndex,
        offsetSeconds: audio.getLiveOffsetSeconds(),
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushExactResumePosition();
      }
    };

    window.addEventListener('pagehide', flushExactResumePosition);
    window.addEventListener('beforeunload', flushExactResumePosition);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pagehide', flushExactResumePosition);
      window.removeEventListener('beforeunload', flushExactResumePosition);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [session, activeChapterIndex, audio.activeSegmentIndex, audio.getLiveOffsetSeconds]);

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

    const delayMs = audio.transportState === 'playing' ? 450 : 80;
    const timer = window.setTimeout(() => {
      const existing = savedBooksRef.current.find((b) => b.id === session.id);
      const record = createSavedBookRecord({
        session,
        bookmarks,
        chapterIndex: activeChapterIndex,
        segmentIndex: audio.activeSegmentIndex,
        offsetSeconds: persistedOffsetSeconds,
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
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [
    session,
    bookmarks,
    activeChapterIndex,
    audio.activeSegmentIndex,
    audio.transportState,
    persistedOffsetSeconds,
  ]);

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

  const abortAllTranslations = useCallback(() => {
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    for (const controller of singleTranslationControllersRef.current) {
      controller.abort();
    }
    singleTranslationControllersRef.current.clear();
  }, []);

  const mountNewSession = useCallback(
    (nextSession: BookSession, autoPlay: boolean) => {
      abortAllTranslations();
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
    [abortAllTranslations, translateChapter]
  );

  const handleImportFile = async (file: File) => {
    importAbortRef.current?.abort();
    const ac = new AbortController();
    importAbortRef.current = ac;

    setErrorMessage(null);
    setExportSuccessMessage(null);
    setIsImportingFile(true);
    setImportProgress({ label: `Lecture de ${file.name}…` });

    try {
      const nextSession = await importDocumentFile(
        file,
        (progress) => {
          setImportProgress(progress);
        },
        ac.signal
      );
      mountNewSession(nextSession, false);
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) {
        setErrorMessage(
          err instanceof Error ? err.message : "Impossible d'importer ce fichier."
        );
      }
    } finally {
      if (importAbortRef.current === ac) {
        importAbortRef.current = null;
      }
      setIsImportingFile(false);
      setImportProgress(null);
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
      audio.jumpToLocation(chapterIndex, 0, false, 0);
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
        autoPlay,
        book.lastPosition.offsetSeconds ?? 0
      );
      document
        .getElementById(autoPlay ? 'lecteur' : 'liseuse')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    abortAllTranslations();
    inflightTranslationsRef.current.clear();
    setTranslationProgress(null);

    pendingRestorePositionRef.current = {
      bookId: book.id,
      chapterIndex: book.lastPosition.chapterIndex,
      segmentIndex: book.lastPosition.segmentIndex,
      offsetSeconds: book.lastPosition.offsetSeconds ?? 0,
      autoPlay,
    };

    sessionRef.current = book.session;
    setSession(book.session);
    setBookmarks(book.bookmarks);
    setActiveChapterIndex(book.lastPosition.chapterIndex);
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
      autoPlay,
      activeSavedBook.lastPosition.offsetSeconds ?? 0
    );
    document
      .getElementById(autoPlay ? 'lecteur' : 'liseuse')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleDeleteSavedBook = async (bookId: string) => {
    clearResumePositionSnapshot(bookId);
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
      abortAllTranslations();
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
          offsetSeconds: nextBook.lastPosition.offsetSeconds ?? 0,
          autoPlay: false,
        };
        sessionRef.current = nextBook.session;
        setSession(nextBook.session);
        setBookmarks(nextBook.bookmarks);
        setActiveChapterIndex(nextBook.lastPosition.chapterIndex);
        void setLastActiveBookId(nextBook.id);
      } else {
        setIsFullscreenListening(false);
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
    clearResumePositionSnapshot();
    exportAbortRef.current?.abort();
    exportAbortRef.current = null;
    importAbortRef.current?.abort();
    importAbortRef.current = null;
    abortAllTranslations();
    inflightTranslationsRef.current.clear();
    pendingRestorePositionRef.current = null;
    setIsFullscreenListening(false);
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
    let mp3Session: BrowserMp3Session | null = null;

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
              stageHeadline: 'Étape 2/3 · Encodage MP3 en arrière-plan',
              detail: `Conversion MP3 128 kbps · ${segDetail}`,
              label: `Encodage MP3 — ${segDetail}`,
              completedSegments: completed,
              totalSegments,
              stepIndex: 2,
              totalSteps: 3,
            });

            if (!mp3Session) {
              mp3Session = await createBrowserMp3Session({
                bitrateKbps: 128,
                signal: ac.signal,
              });
            }

            const dspOptions = {
              pauseOffsets: segAudio.pauseOffsets,
              speed,
              pitchSemitones,
              pauseDurationSeconds,
              includeEndPause: segIdx + 1 < chapter.segments.length,
              hdVoiceEnhanced,
            };

            if (segAudio.mimeType === 'audio/wav') {
              await mp3Session.appendWav(segAudio.rawBytes, dspOptions);
            } else {
              const decoded = await audio.decodeAudioToMonoPcm(segAudio);
              await mp3Session.appendPcm(decoded.samples, decoded.sampleRate, {
                ...dspOptions,
                pauseOffsets: decoded.pauseOffsets,
              });
            }
          }

          completed++;
        }

        if (mp3Session && chIdx < preparedChapters.length - 1) {
          await mp3Session.appendSilence(0.7);
        }
      }

      const baseName =
        scope === 'chapter'
          ? `${currentSession.title}-${preparedChapters[0].title}`
          : `${currentSession.title}-integral`;
      const filename = sanitizeMp3Filename(baseName);

      // Step 3/3: Package final MP3 file in worker RAM (never persisted in browser storage)
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

      let mp3Bytes: Uint8Array;
      if (canFastConcatNeuralMp3 && directMp3Chunks.length > 0 && !mp3Session) {
        const totalLen = directMp3Chunks.reduce((sum, c) => sum + c.length, 0);
        mp3Bytes = new Uint8Array(totalLen);
        let offset = 0;
        for (const chunk of directMp3Chunks) {
          mp3Bytes.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (mp3Session) {
        mp3Bytes = await mp3Session.finalize();
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
      mp3Session?.cancel();
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

  const translatingChapterLabels = useMemo(
    () =>
      session?.chapters.flatMap((chapter, index) =>
        chapter.translationStatus === 'translating' ? [`Chapitre ${index + 1}`] : []
      ) ?? [],
    [session]
  );

  const isActiveChapterTranslating =
    activeChapter?.translationStatus === 'translating' || Boolean(translationProgress);

  const activeGlobalTask = useMemo<{
    task: GlobalTaskProgress;
    onCancel: () => void;
  } | null>(() => {
    if (exportProgress) {
      return {
        task: {
          kind: 'export',
          stage: exportProgress.stage,
          headline: exportProgress.stageHeadline,
          detail:
            exportProgress.stage === 'translating' && browserTranslationStatus
              ? `${exportProgress.detail} · ${browserTranslationStatus}`
              : exportProgress.detail,
          completed: exportProgress.completedSegments,
          total: Math.max(1, exportProgress.totalSegments),
          steps: EXPORT_STEPS,
          activeStepIndex: exportProgress.stepIndex,
          cancelLabel: 'Annuler',
        },
        onCancel: () => exportAbortRef.current?.abort(),
      };
    }

    if (translationProgress) {
      return {
        task: {
          kind: 'translation',
          headline: translationProgress.currentLabel,
          detail:
            browserTranslationStatus ||
            'Traduction locale en français dans un worker dédié…',
          completed: translationProgress.completedChapters,
          total: Math.max(1, translationProgress.totalChapters),
          cancelLabel: 'Annuler',
        },
        onCancel: abortAllTranslations,
      };
    }

    if (translatingChapterLabels.length > 0) {
      return {
        task: {
          kind: 'translation',
          headline: `Traduction EN → FR — ${translatingChapterLabels.join(', ')}`,
          detail:
            browserTranslationStatus ||
            'Traduction locale dans le navigateur (sans appel externe)…',
          percent: null,
          cancelLabel: 'Annuler',
        },
        onCancel: abortAllTranslations,
      };
    }

    if (isImportingFile) {
      return {
        task: {
          kind: 'import',
          headline: 'Import du document en cours',
          detail: importProgress?.label || 'Lecture locale du fichier…',
          completed: importProgress?.completed,
          total: importProgress?.total,
          percent:
            importProgress?.completed && importProgress?.total
              ? Math.round((importProgress.completed / importProgress.total) * 100)
              : null,
          cancelLabel: 'Annuler',
        },
        onCancel: () => importAbortRef.current?.abort(),
      };
    }

    if (audio.bufferingProgress) {
      const bp = audio.bufferingProgress;
      const showCounts = bp.total > 1;
      return {
        task: {
          kind: 'playback',
          headline: bp.headline,
          detail: bp.detail,
          completed: showCounts ? bp.completed : undefined,
          total: showCounts ? bp.total : undefined,
          percent: showCounts ? Math.round((bp.completed / bp.total) * 100) : null,
          cancelLabel: 'Annuler',
        },
        onCancel: audio.stop,
      };
    }

    return null;
  }, [
    abortAllTranslations,
    audio.bufferingProgress,
    audio.stop,
    browserTranslationStatus,
    exportProgress,
    importProgress,
    isImportingFile,
    translatingChapterLabels,
    translationProgress,
  ]);

  const activeVoiceStatus = voiceStatuses[neuralVoiceId];

  const handleDownloadVoice = useCallback(async (voiceId: NeuralVoiceId) => {
    if (!supportsVoiceModelStorage()) {
      setVoiceStatuses((prev) => ({
        ...prev,
        [voiceId]: {
          ...prev[voiceId],
          installState: 'unsupported',
          healthState: 'failed',
          errorMessage:
            'Le stockage des modèles vocaux exige une origine sécurisée (localhost ou HTTPS).',
        },
      }));
      return;
    }

    setVoiceStatuses((prev) => ({
      ...prev,
      [voiceId]: {
        ...prev[voiceId],
        installState: 'downloading',
        downloadPercent: 0,
        errorMessage: null,
      },
    }));

    try {
      const info = await downloadVoiceModel(voiceId, (percent) => {
        setVoiceStatuses((prev) => ({
          ...prev,
          [voiceId]: {
            ...prev[voiceId],
            installState: 'downloading',
            downloadPercent: percent,
          },
        }));
      });

      clearVoiceHealthEntry(voiceId);
      setVoiceStatuses((prev) => ({
        ...prev,
        [voiceId]: {
          ...prev[voiceId],
          installState: 'installed',
          healthState: 'untested',
          downloadPercent: 100,
          sizeBytes: info.sizeBytes,
          errorMessage: null,
        },
      }));
      setNeuralVoiceId(voiceId);
      setShowVoiceDownload(false);
      setErrorMessage(null);
      const nextMetrics = await measureBrowserStorage(savedBooksRef.current);
      setStorageMetrics(nextMetrics);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Impossible de télécharger la voix.';
      setVoiceStatuses((prev) => ({
        ...prev,
        [voiceId]: {
          ...prev[voiceId],
          installState: 'error',
          healthState: 'failed',
          downloadPercent: 0,
          errorMessage: msg,
        },
      }));
    }
  }, []);

  const handleSelectOrDownloadVoice = useCallback(
    (voiceId: NeuralVoiceId) => {
      const current = voiceStatuses[voiceId];
      if (!current || current.installState === 'downloading' || current.installState === 'unsupported') {
        return;
      }
      if (current.installState === 'installed') {
        setNeuralVoiceId(voiceId);
        setErrorMessage(null);
        return;
      }
      void handleDownloadVoice(voiceId);
    },
    [handleDownloadVoice, voiceStatuses]
  );

  const previewAudioCtxRef = useRef<AudioContext | null>(null);

  const handleTestVoice = useCallback(
    async (voiceId: NeuralVoiceId) => {
      // Unlock an AudioContext synchronously on click so the preview plays smoothly
      let previewCtx: AudioContext | null = null;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!previewAudioCtxRef.current || previewAudioCtxRef.current.state === 'closed') {
          previewAudioCtxRef.current = new AudioCtx();
        }
        previewCtx = previewAudioCtxRef.current;
        if (previewCtx.state === 'suspended') {
          void previewCtx.resume().catch(() => {});
        }
      } catch {
        previewCtx = null;
      }

      setVoiceStatuses((prev) => ({
        ...prev,
        [voiceId]: {
          ...prev[voiceId],
          healthState: 'testing',
          errorMessage: null,
        },
      }));

      try {
        const voiceName = getNeuralVoiceById(voiceId).name;
        const wavBlob = await synthesizeInBrowser(
          `Bonjour, ici la voix ${voiceName}. La synthèse fonctionne parfaitement.`,
          voiceId
        );
        const wav = parseWavBuffer(await wavBlob.arrayBuffer());
        if (wav.samples.length === 0) {
          throw new Error('Aucun signal audio généré.');
        }

        const readySamples = hdVoiceEnhanced
          ? enhanceVoiceHdFluid(wav.samples, wav.sampleRate)
          : wav.samples;

        if (previewCtx) {
          const buffer = previewCtx.createBuffer(1, readySamples.length, wav.sampleRate);
          buffer.copyToChannel(new Float32Array(readySamples), 0);
          const src = previewCtx.createBufferSource();
          const gain = previewCtx.createGain();
          gain.gain.value = muted ? 0 : volume;
          src.buffer = buffer;
          src.connect(gain);
          gain.connect(previewCtx.destination);
          src.start();
        }

        writeVoiceHealthEntry(voiceId, 'working', null);
        setVoiceStatuses((prev) => ({
          ...prev,
          [voiceId]: {
            ...prev[voiceId],
            installState: 'installed',
            healthState: 'working',
            errorMessage: null,
          },
        }));
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : 'Échec du test de synthèse vocale.';
        writeVoiceHealthEntry(voiceId, 'failed', msg);
        setVoiceStatuses((prev) => ({
          ...prev,
          [voiceId]: {
            ...prev[voiceId],
            healthState: 'failed',
            errorMessage: msg,
          },
        }));
      }
    },
    [hdVoiceEnhanced, muted, volume]
  );

  const handleDeleteVoice = useCallback(
    async (voiceId: NeuralVoiceId) => {
      if (voiceId === neuralVoiceId) {
        audio.clearAudioMemory();
      }

      await removeVoiceModel(voiceId);

      setVoiceStatuses((prev) => {
        const next: Record<NeuralVoiceId, VoiceRuntimeStatus> = {
          ...prev,
          [voiceId]: {
            installState: 'missing',
            healthState: 'untested',
            downloadPercent: 0,
            sizeBytes: null,
            errorMessage: null,
          },
        };

        if (voiceId === neuralVoiceId) {
          const fallback = NEURAL_FRENCH_VOICES.find(
            (v) => v.id !== voiceId && next[v.id]?.installState === 'installed'
          );
          if (fallback) {
            setNeuralVoiceId(fallback.id);
          }
        }
        return next;
      });

      const nextMetrics = await measureBrowserStorage(savedBooksRef.current);
      setStorageMetrics(nextMetrics);
    },
    [audio, neuralVoiceId]
  );

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
              {activeVoiceStatus.installState === 'unsupported'
                ? 'Cette adresse HTTP ne permet pas au navigateur d’enregistrer le modèle vocal.'
                : <>Le modèle Piper <span className="font-mono">{neuralVoiceId}</span> sera enregistré dans le stockage privé de votre navigateur. Vous pourrez aussi télécharger ou supprimer d’autres voix françaises à tout moment.</>}
            </p>

            {activeVoiceStatus.installState === 'downloading' ? (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-xs text-[#55585e]">
                  <span>Téléchargement de la voix…</span>
                  <span className="font-mono tabular-nums">
                    {activeVoiceStatus.downloadPercent}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#ddd8cc]">
                  <div
                    className="h-full rounded-full bg-[#d9531e] transition-[width]"
                    style={{ width: `${activeVoiceStatus.downloadPercent}%` }}
                  />
                </div>
              </div>
            ) : activeVoiceStatus.installState !== 'unsupported' ? (
              <button
                type="button"
                onClick={() => void handleDownloadVoice(neuralVoiceId)}
                className="mt-5 w-full rounded-lg bg-[#d9531e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#c24515]"
              >
                Télécharger {getNeuralVoiceById(neuralVoiceId).name}
              </button>
            ) : null}

            {(activeVoiceStatus.installState === 'error' ||
              activeVoiceStatus.installState === 'unsupported') &&
              activeVoiceStatus.errorMessage && (
              <p className="mt-3 rounded-lg border border-[#d49a89] bg-[#fbefeb] px-3 py-2 text-xs text-[#8a280b]">
                {activeVoiceStatus.errorMessage}
              </p>
            )}

            {activeVoiceStatus.installState !== 'downloading' && (
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

      {isFullscreenListening ? (
        <>
          {activeGlobalTask && (
            <GlobalProgressBar
              task={activeGlobalTask.task}
              onCancel={activeGlobalTask.onCancel}
              darkSurface
            />
          )}
          <FullscreenListeningView
            session={session}
            activeChapter={activeChapter}
            activeChapterIndex={activeChapterIndex}
            neuralVoiceId={neuralVoiceId}
            voiceStatuses={voiceStatuses}
            transportState={audio.transportState}
            activeSegmentIndex={audio.activeSegmentIndex}
            totalSegmentsInChapter={audio.totalSegmentsInChapter}
            segmentCurrentTime={audio.segmentCurrentTime}
            segmentDuration={audio.segmentDuration}
            chapterProgressRatio={audio.chapterProgressRatio}
            speed={speed}
            pitchSemitones={pitchSemitones}
            pauseDurationSeconds={pauseDurationSeconds}
            hdVoiceEnhanced={hdVoiceEnhanced}
            volume={volume}
            muted={muted}
            isExporting={Boolean(exportProgress)}
            isTranslating={isActiveChapterTranslating}
            isCurrentSegmentBookmarked={isCurrentSegmentBookmarked}
            errorMessage={errorMessage}
            onExitFullscreen={() => setIsFullscreenListening(false)}
            onPlay={() => void audio.play()}
            onPause={audio.pause}
            onStop={audio.stop}
            onRewind={audio.rewind}
            onFastForward={audio.fastForward}
            onPrevChapter={() => handleSelectChapter(activeChapterIndex - 1, true)}
            onNextChapter={() => handleSelectChapter(activeChapterIndex + 1, true)}
            onSelectChapter={(chapterIdx) =>
              handleSelectChapter(chapterIdx, audio.transportState === 'playing')
            }
            onPrevSegment={() =>
              audio.jumpToSegment(
                Math.max(0, audio.activeSegmentIndex - 1),
                audio.transportState === 'playing'
              )
            }
            onNextSegment={() =>
              audio.jumpToSegment(
                Math.min(
                  Math.max(0, audio.totalSegmentsInChapter - 1),
                  audio.activeSegmentIndex + 1
                ),
                audio.transportState === 'playing'
              )
            }
            onSeekSegment={audio.seekSegment}
            onSpeedChange={(s) => setSpeed(Math.round(s * 100) / 100)}
            onPitchChange={(p) => setPitchSemitones(Math.round(p * 10) / 10)}
            onPauseDurationChange={setPauseDurationSeconds}
            onToggleHdVoice={() => setHdVoiceEnhanced((prev) => !prev)}
            onSelectOrDownloadVoice={handleSelectOrDownloadVoice}
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
            onTranslateActiveChapter={() => void handleTranslateSingleChapter(activeChapterIndex)}
          />
        </>
      ) : (
        <>
          <TopBar
            storageMetrics={storageMetrics}
            hasAnyData={Boolean(savedBooks.length > 0 || session || draftText.trim())}
            hasBook={Boolean(session && activeChapter)}
            onEnterFullscreen={() => setIsFullscreenListening(true)}
            onClearAllStorage={handleClearAllStorage}
          />

          {activeGlobalTask && (
            <GlobalProgressBar
              task={activeGlobalTask.task}
              onCancel={activeGlobalTask.onCancel}
            />
          )}

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
            onEnterFullscreen={() => setIsFullscreenListening(true)}
          />

          <main className="mx-auto max-w-[1280px] space-y-6 px-4 pt-5 pb-28 sm:px-6 sm:pt-7 md:space-y-8 md:px-8 md:pt-8 md:pb-10 md:pr-20">
            {/* 1. Poste principal : Walkman + Import/Collage (sur mobile : Lecteur d'abord si un livre est chargé, sinon Import d'abord) */}
            <div className="grid grid-cols-1 items-start gap-5 sm:gap-7 lg:grid-cols-12">
              <div
                className={`min-w-0 lg:order-1 lg:col-span-6 xl:col-span-5 ${
                  session ? 'order-1' : 'order-2'
                }`}
              >
                <WalkmanDeck
                  session={session}
                  activeChapter={activeChapter}
                  activeChapterIndex={activeChapterIndex}
                  neuralVoiceId={neuralVoiceId}
                  voiceStatuses={voiceStatuses}
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
                  hdVoiceEnhanced={hdVoiceEnhanced}
                  volume={volume}
                  muted={muted}
                  isExporting={Boolean(exportProgress)}
                  playbackErrorMessage={errorMessage}
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
                  onToggleHdVoice={() => setHdVoiceEnhanced((prev) => !prev)}
                  onSelectOrDownloadVoice={handleSelectOrDownloadVoice}
                  onTestVoice={(voiceId) => void handleTestVoice(voiceId)}
                  onDeleteVoice={(voiceId) => void handleDeleteVoice(voiceId)}
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
                  onEnterFullscreen={() => setIsFullscreenListening(true)}
                  onExportChapterMp3={() => void runIncrementalMp3Export('chapter')}
                  onExportBookMp3={() => void runIncrementalMp3Export('book')}
                  onDismissReadyMp3={() => replaceReadyMp3(null)}
                />
              </div>

              <div
                className={`min-w-0 lg:order-2 lg:col-span-6 xl:col-span-7 ${
                  session ? 'order-2' : 'order-1'
                }`}
              >
                <TextStudio
                  session={session}
                  neuralVoiceId={neuralVoiceId}
                  draftTitle={draftTitle}
                  draftText={draftText}
                  speed={speed}
                  isImportingFile={isImportingFile}
                  importStatusLabel={importProgress?.label ?? null}
                  autoTranslateToFrench={autoTranslateToFrench}
                  translationProgress={translationProgress}
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
                  onClearDraft={() => {
                    setDraftText('');
                    setDraftTitle('');
                    setErrorMessage(null);
                  }}
                />
              </div>
            </div>

            {/* 2. Liseuse française synchronisée directement sous le Walkman */}
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

            {/* 3. Chapitres & Marque-pages du livre actif */}
            <ChapterList
              session={session}
              activeChapterIndex={activeChapterIndex}
              activeSegmentIndex={audio.activeSegmentIndex}
              isPlaying={audio.transportState === 'playing'}
              isExporting={Boolean(exportProgress)}
              readyMp3={readyMp3}
              exportErrorMessage={exportErrorMessage}
              savedPosition={activeSavedBook?.lastPosition ?? null}
              bookmarks={bookmarks}
              onSelectChapter={handleSelectChapter}
              onTranslateChapter={(idx) => void handleTranslateSingleChapter(idx)}
              onExportChapterMp3={(idx) => void runIncrementalMp3Export('chapter', idx)}
              onExportBookMp3={() => void runIncrementalMp3Export('book')}
              onDismissReadyMp3={() => replaceReadyMp3(null)}
              onResumeSavedPosition={handleResumeCurrentSavedPosition}
              onJumpToBookmark={handleJumpToBookmark}
              onUpdateBookmarkNote={handleUpdateBookmarkNote}
              onDeleteBookmark={handleDeleteBookmark}
            />

            {/* 4. Ma Bibliothèque locale pour changer de livre */}
            <BookLibrary
              books={savedBooks}
              activeBookId={session?.id ?? null}
              onResumeBook={handleResumeBook}
              onDeleteBook={(id) => void handleDeleteSavedBook(id)}
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
        </>
      )}
    </div>
  );
}
