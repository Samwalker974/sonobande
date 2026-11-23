import type {
  BookmarkItem,
  BookSession,
  BrowserStorageMetrics,
  ReadingPosition,
  SavedBookRecord,
} from '../types/walkman';
import { buildBookmarkExcerpt } from './languageDetect';
import { stripParasiticCharacters } from './speechSanitizer';

const DB_NAME = 'sonobande-books-text-v2';
const DB_VERSION = 1;
const BOOKS_STORE = 'books';
const META_STORE = 'meta';
const ACTIVE_BOOK_META_KEY = 'activeBookId';

/**
 * Formats a byte size cleanly in French units (o, Ko, Mo, Go).
 */
export function formatStorageSizeFr(bytes: number): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) {
    return `${Math.round(safe)} o`;
  }
  const kb = safe / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1).replace('.', ',') : Math.round(kb)} Ko`;
  }
  const mb = kb / 1024;
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} Mo`;
  }
  const gb = mb / 1024;
  return `${gb.toFixed(1).replace('.', ',')} Go`;
}

/**
 * Computes an accurate UTF-8 byte estimate for a text-only SavedBookRecord.
 */
export function estimateTextRecordBytes(record: Omit<SavedBookRecord, 'textSizeBytes'>): number {
  const json = JSON.stringify(record);
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(json).byteLength;
  }
  return json.length * 2;
}

/**
 * Produces a strictly text-only sanitized BookSession snapshot (no transient
 * "translating" state and never any audio/MP3 buffers).
 */
export function sanitizeSessionForTextStorage(session: BookSession): BookSession {
  return {
    id: session.id,
    title: session.title,
    source: session.source,
    fileName: session.fileName,
    detectedLanguage: session.detectedLanguage,
    totalChars: session.totalChars,
    totalEstimatedSeconds: session.totalEstimatedSeconds,
    chapters: session.chapters.map((ch) => {
      const normalizedStatus =
        ch.translationStatus === 'translating' ? 'needs_translation' : ch.translationStatus;
      const shouldCleanText =
        normalizedStatus === 'translated' || normalizedStatus === 'french_native';
      const cleanTitle = shouldCleanText
        ? stripParasiticCharacters(ch.title) || ch.title
        : ch.title;
      const cleanText = shouldCleanText
        ? stripParasiticCharacters(ch.text) || ch.text
        : ch.text;
      const cleanSegments = shouldCleanText
        ? ch.segments
            .map((seg) => stripParasiticCharacters(seg))
            .filter((seg) => seg.length > 0)
        : [...ch.segments];

      return {
        id: ch.id,
        index: ch.index,
        title: cleanTitle,
        text: cleanText,
        sourceTitle: ch.sourceTitle,
        sourceText: ch.sourceText,
        translationStatus: normalizedStatus,
        segments: cleanSegments.length > 0 ? cleanSegments : [cleanText],
        charCount: cleanText.length,
        estimatedSeconds: ch.estimatedSeconds,
      };
    }),
  };
}

/**
 * Builds an up-to-date automatic stop-position bookmark for a book session.
 */
export function buildReadingPosition(
  session: BookSession,
  chapterIndex: number,
  segmentIndex: number
): ReadingPosition {
  const clampedChapterIdx = Math.max(
    0,
    Math.min(chapterIndex, Math.max(0, session.chapters.length - 1))
  );
  const chapter = session.chapters[clampedChapterIdx];
  const totalSegments = Math.max(1, chapter?.segments.length ?? 1);
  const clampedSegmentIdx = Math.max(0, Math.min(segmentIndex, totalSegments - 1));

  const isUntranslated = chapter?.translationStatus === 'needs_translation';
  const rawSegmentText = isUntranslated
    ? ''
    : chapter?.segments[clampedSegmentIdx] ?? chapter?.text ?? '';

  return {
    chapterIndex: clampedChapterIdx,
    chapterTitle: isUntranslated
      ? `Chapitre ${clampedChapterIdx + 1} (à traduire)`
      : chapter?.title ?? `Chapitre ${clampedChapterIdx + 1}`,
    segmentIndex: clampedSegmentIdx,
    totalSegments,
    excerpt: rawSegmentText ? buildBookmarkExcerpt(rawSegmentText, 110) : 'Début du chapitre',
    updatedAt: Date.now(),
  };
}

/**
 * Creates a strictly text-only SavedBookRecord ready for browser IndexedDB storage.
 */
export function createSavedBookRecord(params: {
  session: BookSession;
  bookmarks: BookmarkItem[];
  chapterIndex: number;
  segmentIndex: number;
  existingSavedAt?: number;
}): SavedBookRecord {
  const cleanSession = sanitizeSessionForTextStorage(params.session);
  const lastPosition = buildReadingPosition(
    cleanSession,
    params.chapterIndex,
    params.segmentIndex
  );
  const now = Date.now();
  const base: Omit<SavedBookRecord, 'textSizeBytes'> = {
    id: cleanSession.id,
    session: cleanSession,
    bookmarks: params.bookmarks.map((bm) => ({ ...bm })),
    lastPosition,
    savedAt: params.existingSavedAt ?? now,
    updatedAt: now,
  };
  return {
    ...base,
    textSizeBytes: estimateTextRecordBytes(base),
  };
}

function openBooksDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible dans ce navigateur.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BOOKS_STORE)) {
        db.createObjectStore(BOOKS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Impossible d'ouvrir la bibliothèque locale."));
  });
}

function normalizeSavedBookRecord(raw: unknown): SavedBookRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SavedBookRecord>;
  if (
    typeof candidate.id !== 'string' ||
    !candidate.session ||
    typeof candidate.session !== 'object' ||
    !Array.isArray(candidate.session.chapters) ||
    candidate.session.chapters.length === 0
  ) {
    return null;
  }

  const cleanSession = sanitizeSessionForTextStorage(candidate.session);
  const rawPos = candidate.lastPosition;
  const lastPosition = buildReadingPosition(
    cleanSession,
    typeof rawPos?.chapterIndex === 'number' ? rawPos.chapterIndex : 0,
    typeof rawPos?.segmentIndex === 'number' ? rawPos.segmentIndex : 0
  );
  if (typeof rawPos?.updatedAt === 'number') {
    lastPosition.updatedAt = rawPos.updatedAt;
  }

  const bookmarks = Array.isArray(candidate.bookmarks)
    ? candidate.bookmarks.filter(
        (bm): bm is BookmarkItem =>
          Boolean(bm && typeof bm === 'object' && typeof bm.id === 'string')
      )
    : [];

  const savedAt = typeof candidate.savedAt === 'number' ? candidate.savedAt : Date.now();
  const updatedAt = typeof candidate.updatedAt === 'number' ? candidate.updatedAt : savedAt;
  const base: Omit<SavedBookRecord, 'textSizeBytes'> = {
    id: cleanSession.id,
    session: cleanSession,
    bookmarks,
    lastPosition,
    savedAt,
    updatedAt,
  };

  return {
    ...base,
    textSizeBytes:
      typeof candidate.textSizeBytes === 'number' && candidate.textSizeBytes > 0
        ? candidate.textSizeBytes
        : estimateTextRecordBytes(base),
  };
}

export async function loadAllSavedBooks(): Promise<SavedBookRecord[]> {
  try {
    const db = await openBooksDatabase();
    return await new Promise<SavedBookRecord[]>((resolve, reject) => {
      const tx = db.transaction(BOOKS_STORE, 'readonly');
      const req = tx.objectStore(BOOKS_STORE).getAll();
      req.onsuccess = () => {
        const rawList = Array.isArray(req.result) ? req.result : [];
        const list = rawList
          .map((item) => normalizeSavedBookRecord(item))
          .filter((item): item is SavedBookRecord => item !== null);
        list.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return [];
  }
}

export async function saveBookRecord(record: SavedBookRecord): Promise<void> {
  const db = await openBooksDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BOOKS_STORE, 'readwrite');
    tx.objectStore(BOOKS_STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Échec de sauvegarde du livre dans le navigateur.'));
    };
  });
}

export async function deleteSavedBook(bookId: string): Promise<void> {
  const db = await openBooksDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS_STORE, META_STORE], 'readwrite');
    tx.objectStore(BOOKS_STORE).delete(bookId);
    const metaStore = tx.objectStore(META_STORE);
    const getReq = metaStore.get(ACTIVE_BOOK_META_KEY);
    getReq.onsuccess = () => {
      if (getReq.result === bookId) {
        metaStore.delete(ACTIVE_BOOK_META_KEY);
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Échec de suppression du livre.'));
    };
  });
}

export async function clearAllSavedBooks(): Promise<void> {
  const db = await openBooksDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BOOKS_STORE, META_STORE], 'readwrite');
    tx.objectStore(BOOKS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('Échec du vidage du stockage local.'));
    };
  });
}

export async function getLastActiveBookId(): Promise<string | null> {
  try {
    const db = await openBooksDatabase();
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const req = tx.objectStore(META_STORE).get(ACTIVE_BOOK_META_KEY);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function setLastActiveBookId(bookId: string | null): Promise<void> {
  try {
    const db = await openBooksDatabase();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      const store = tx.objectStore(META_STORE);
      if (bookId) {
        store.put(bookId, ACTIVE_BOOK_META_KEY);
      } else {
        store.delete(ACTIVE_BOOK_META_KEY);
      }
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore storage restriction
  }
}

export async function measureBrowserStorage(
  savedBooks: SavedBookRecord[]
): Promise<BrowserStorageMetrics> {
  const libraryTextBytes = savedBooks.reduce((sum, b) => sum + (b.textSizeBytes || 0), 0);

  let browserUsageBytes: number | null = null;
  let browserQuotaBytes: number | null = null;
  let remainingBytes: number | null = null;
  let percentUsed: number | null = null;

  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number' && est.quota > 0) {
        const usage = typeof est.usage === 'number' ? est.usage : libraryTextBytes;
        browserUsageBytes = Math.max(usage, libraryTextBytes);
        browserQuotaBytes = est.quota;
        remainingBytes = Math.max(0, est.quota - browserUsageBytes);
        percentUsed = Math.min(100, (browserUsageBytes / est.quota) * 100);
      }
    }
  } catch {
    // Some private browsing modes disallow storage.estimate()
  }

  return {
    booksCount: savedBooks.length,
    libraryTextBytes,
    browserUsageBytes,
    browserQuotaBytes,
    remainingBytes,
    percentUsed,
  };
}
