import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Languages,
  Loader2,
  Play,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  BookSession,
  BookmarkItem,
  ChapterItem,
  ExportProgress,
  ReadingPosition,
  ReadyMp3Download,
} from '../types/walkman';
import { formatLongDuration } from '../utils/bookSplitter';
import { formatByteSizeFr } from '../utils/mp3Encoder';
import { MAX_AUTO_SAVED_DOCUMENT_CHARS } from '../utils/documentLimits';
import { ExportProgressCard } from './ExportProgressCard';

const CHAPTERS_PER_PAGE = 50;

interface ChapterListProps {
  session: BookSession | null;
  activeChapterIndex: number;
  activeSegmentIndex: number;
  isPlaying: boolean;
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  readyMp3: ReadyMp3Download | null;
  exportErrorMessage: string | null;
  savedPosition: ReadingPosition | null;
  bookmarks: BookmarkItem[];
  onSelectChapter: (chapterIndex: number, autoPlay: boolean) => void;
  onTranslateChapter: (chapterIndex: number) => void;
  onExportChapterMp3: (chapterIndex: number) => void;
  onExportBookMp3: () => void;
  onCancelExport: () => void;
  onDismissReadyMp3: () => void;
  onResumeSavedPosition: (autoPlay: boolean) => void;
  onJumpToBookmark: (bookmark: BookmarkItem, autoPlay: boolean) => void;
  onUpdateBookmarkNote: (bookmarkId: string, note: string) => void;
  onDeleteBookmark: (bookmarkId: string) => void;
}

const SOURCE_LABELS: Record<BookSession['source'], string> = {
  pdf: 'PDF local',
  epub: 'EPUB local',
  txt: 'Fichier TXT',
  paste: 'Texte collé',
};

export function ChapterList({
  session,
  activeChapterIndex,
  activeSegmentIndex,
  isPlaying,
  isExporting,
  exportProgress,
  readyMp3,
  exportErrorMessage,
  savedPosition,
  bookmarks,
  onSelectChapter,
  onTranslateChapter,
  onExportChapterMp3,
  onExportBookMp3,
  onCancelExport,
  onDismissReadyMp3,
  onResumeSavedPosition,
  onJumpToBookmark,
  onUpdateBookmarkNote,
  onDeleteBookmark,
}: ChapterListProps) {
  const [activeTab, setActiveTab] = useState<'chapters' | 'bookmarks'>('chapters');
  const [chapterPage, setChapterPage] = useState(0);

  useEffect(() => {
    setChapterPage(Math.floor(activeChapterIndex / CHAPTERS_PER_PAGE));
  }, [session?.id, activeChapterIndex]);

  if (!session) {
    return (
      <section
        id="chapitres"
        aria-label="Table des chapitres et marque-pages en mémoire"
        className="rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-6"
      >
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight text-[#1c1e21]">
              Chapitres &amp; Marque-pages du livre actif
            </h2>
            <p className="mt-0.5 text-xs text-[#5b5e64]">
              Texte et position d’arrêt sauvegardés dans votre navigateur · Aucun MP3 stocké
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#cdc7ba] bg-[#f2efe8] px-6 py-10 text-center">
          <BookOpen className="h-7 w-7 text-[#6b6d73]" aria-hidden="true" />
          <p className="mt-3 font-display text-base font-semibold text-[#1c1e21]">
            Aucun document chargé en mémoire
          </p>
          <p className="mt-1 max-w-md text-sm text-[#5b5e64]">
            Importez un livre français ou anglais (PDF, EPUB, TXT) ou collez votre texte ci-dessus. Les chapitres traduits et vos marque-pages de session apparaîtront ici.
          </p>
        </div>
      </section>
    );
  }

  const totalSegments = session.chapters.reduce((sum, c) => sum + c.segments.length, 0);
  const pageCount = Math.max(1, Math.ceil(session.chapters.length / CHAPTERS_PER_PAGE));
  const currentPage = Math.min(chapterPage, pageCount - 1);
  const pageStart = currentPage * CHAPTERS_PER_PAGE;
  const pageEnd = Math.min(pageStart + CHAPTERS_PER_PAGE, session.chapters.length);
  const visibleChapters = session.chapters.slice(pageStart, pageEnd);

  return (
    <section
      id="chapitres"
      aria-label="Table des chapitres et marque-pages en mémoire"
      className="rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-5 sm:p-6"
    >
      {/* Header + Tab Switcher */}
      <div className="flex flex-col gap-4 border-b border-[#e2ddd3] pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="font-display text-xl font-bold tracking-tight text-[#1c1e21]">
            {session.title}
          </h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#55585e]">
            <span>{SOURCE_LABELS[session.source]}</span>
            <span aria-hidden="true">·</span>
            <span>
              {session.detectedLanguage === 'en' ? 'Anglais → Français' : 'Français'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {session.chapters.length}{' '}
              {session.chapters.length > 1 ? 'chapitres' : 'chapitre'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Durée estimée {formatLongDuration(session.totalEstimatedSeconds)}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {session.totalChars > MAX_AUTO_SAVED_DOCUMENT_CHARS
                ? 'Non sauvegardé (document volumineux)'
                : 'Sauvegardé dans le navigateur (texte seul)'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Two-tab switcher: Chapitres / Marque-pages */}
          <div
            role="tablist"
            aria-label="Navigation chapitres et marque-pages"
            className="inline-flex rounded-lg bg-[#e8e4db] p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chapters'}
              onClick={() => setActiveTab('chapters')}
              data-testid="tab-chapters"
              className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'chapters'
                  ? 'bg-white text-[#1c1e21] shadow-xs'
                  : 'text-[#4e5157] hover:text-[#1c1e21]'
              }`}
            >
              Chapitres ({session.chapters.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'bookmarks'}
              onClick={() => setActiveTab('bookmarks')}
              data-testid="tab-bookmarks"
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                activeTab === 'bookmarks'
                  ? 'bg-white text-[#1c1e21] shadow-xs'
                  : 'text-[#4e5157] hover:text-[#1c1e21]'
              }`}
            >
              <Bookmark className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
              <span>Marque-pages ({bookmarks.length})</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onExportBookMp3}
            disabled={isExporting}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#1c1e21] px-4 py-2 text-xs font-semibold text-[#f7f5f0] whitespace-nowrap transition-colors hover:bg-[#31343a] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>MP3 livre entier ({totalSegments} seg.)</span>
          </button>
        </div>
      </div>

      {/* Inline MP3 export step-by-step feedback right inside ChapterList */}
      {exportProgress && (
        <div className="mt-4">
          <ExportProgressCard progress={exportProgress} onCancel={onCancelExport} compact />
        </div>
      )}

      {!exportProgress && exportErrorMessage && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#d49a89] bg-[#fbefeb] px-4 py-3 text-xs text-[#7c240a]"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#c93e18]" aria-hidden="true" />
          <p className="leading-relaxed">{exportErrorMessage}</p>
        </div>
      )}

      {!exportProgress && readyMp3 && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#b9d3bf] bg-[#eef6f0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-[#2c5e3b]" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[#1e4229]">
                MP3 prêt : {readyMp3.filename}
              </p>
              <p className="font-mono text-[11px] tabular-nums text-[#3b6a49]">
                {formatByteSizeFr(readyMp3.sizeBytes)} · En mémoire vive uniquement
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={readyMp3.url}
              download={readyMp3.filename}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2c5e3b] px-3.5 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#224b2f] focus-visible:outline-2 focus-visible:outline-[#2c5e3b]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Télécharger le MP3</span>
            </a>
            <button
              type="button"
              onClick={onDismissReadyMp3}
              aria-label="Fermer la carte de téléchargement MP3"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#b9d3bf] bg-white text-[#2c5e3b] hover:bg-[#e3efe6]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {session.totalChars > MAX_AUTO_SAVED_DOCUMENT_CHARS && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-[#d6c9b8] bg-[#f3ece0] px-3 py-2 text-xs text-[#6a4b31]"
        >
          Ce document volumineux reste lisible dans cet onglet, mais n’est pas sauvegardé automatiquement. Gardez cette page ouverte ou découpez le livre en parties plus petites.
        </p>
      )}

      {/* Tab Panel 1: Ephemeral Chapter List */}
      {activeTab === 'chapters' ? (
        <>
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs">
              <span className="font-mono tabular-nums text-[#55585e]">
                Chapitres {pageStart + 1}–{pageEnd} sur {session.chapters.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage === 0}
                  onClick={() => setChapterPage((page) => Math.max(0, page - 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-[#cfc9bd] bg-white px-2.5 py-1.5 font-medium text-[#34373c] hover:bg-[#f1eee6] disabled:opacity-45"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Précédents
                </button>
                <button
                  type="button"
                  disabled={currentPage >= pageCount - 1}
                  onClick={() => setChapterPage((page) => Math.min(pageCount - 1, page + 1))}
                  className="inline-flex items-center gap-1 rounded-md border border-[#cfc9bd] bg-white px-2.5 py-1.5 font-medium text-[#34373c] hover:bg-[#f1eee6] disabled:opacity-45"
                >
                  Suivants
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          <ol
            data-testid="chapter-list"
            className="mt-4 divide-y divide-[#e6e1d7] rounded-xl border border-[#e0dbd0] bg-white"
          >
            {visibleChapters.map((chapter: ChapterItem, pageIndex) => {
              const idx = pageStart + pageIndex;
              const isCurrent = idx === activeChapterIndex;
              const isNeedsTranslation = chapter.translationStatus === 'needs_translation';
              const isTranslating = chapter.translationStatus === 'translating';
              const isTranslated = chapter.translationStatus === 'translated';

              const displayTitle = isNeedsTranslation
                ? `Chapitre ${idx + 1} (anglais — à traduire)`
                : chapter.title;

              return (
                <li
                  key={chapter.id}
                  className={`flex flex-col gap-3 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                    isCurrent ? 'bg-[#fbf7f2]' : 'hover:bg-[#faf8f4]'
                  }`}
                >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2.5">
                    <span className="font-mono text-xs font-semibold tabular-nums text-[#7b786e]">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectChapter(idx, false)}
                      className="truncate text-left font-display text-sm font-semibold text-[#1c1e21] hover:text-[#b93e0e] focus-visible:outline-2 focus-visible:outline-[#d9531e] sm:text-base"
                    >
                      {displayTitle}
                    </button>
                  </div>
                  <p className="mt-0.5 pl-6 text-xs text-[#5b5e64]">
                    <span className="font-mono tabular-nums">
                      ~{formatLongDuration(chapter.estimatedSeconds)}
                    </span>
                    <span className="mx-1.5" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {chapter.segments.length}{' '}
                      {chapter.segments.length > 1 ? 'segments' : 'segment'}
                    </span>
                    {isTranslated && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-medium text-[#2c5e3b]">Traduit en français</span>
                      </>
                    )}
                    {isNeedsTranslation && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>À traduire en français</span>
                      </>
                    )}
                    {isTranslating && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-medium text-[#b93e0e]">Traduction en cours…</span>
                      </>
                    )}
                    {isCurrent && (
                      <>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-medium text-[#b93e0e]">
                          {isPlaying
                            ? `En lecture (segment ${activeSegmentIndex + 1}/${chapter.segments.length})`
                            : 'Chargé dans le Walkman'}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 line-clamp-1 pl-6 text-xs text-[#6d7076]">
                    {isNeedsTranslation
                      ? 'Cliquez sur « Traduire » ou « Écouter » pour afficher ce chapitre en français.'
                      : `${chapter.text.slice(0, 180).replace(/\s+/g, ' ').trim()}${chapter.text.length > 180 ? '…' : ''}`}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 pl-6 sm:pl-0">
                  {isNeedsTranslation && (
                    <button
                      type="button"
                      onClick={() => onTranslateChapter(idx)}
                      aria-label={`Traduire le chapitre ${idx + 1} en français`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#d6c2ae] bg-[#f7efe6] px-3 py-1.5 text-xs font-semibold text-[#8f2e08] whitespace-nowrap transition-colors hover:bg-[#f0e3d4] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                    >
                      <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Traduire</span>
                    </button>
                  )}

                  {isTranslating && (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-[#b93e0e]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      <span>Traduction…</span>
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => onSelectChapter(idx, true)}
                    disabled={isTranslating}
                    aria-label={`Écouter « ${displayTitle} »`}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:opacity-45 ${
                      isCurrent
                        ? 'bg-[#d9531e] text-white hover:bg-[#c24515]'
                        : 'bg-[#1c1e21] text-[#f7f5f0] hover:bg-[#31343a]'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>{isCurrent && isPlaying ? 'En cours' : 'Écouter'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onExportChapterMp3(idx)}
                    disabled={isExporting || isTranslating}
                    aria-label={`Télécharger « ${displayTitle} » en MP3`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-[#f7f5f0] px-3 py-1.5 text-xs font-medium text-[#25272b] whitespace-nowrap transition-colors hover:bg-[#ece8df] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
                  >
                    <Download className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                    <span>MP3</span>
                  </button>
                </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : (
        /* Tab Panel 2: Auto-Saved Stop Position + Manual Bookmarks */
        <div className="mt-4 space-y-3" data-testid="bookmarks-panel">
          {savedPosition && (
            <div
              data-testid="auto-stop-bookmark-card"
              className="flex flex-col gap-3 rounded-xl border border-[#d6c2ae] bg-[#f8f1e8] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-[#8f2e08]">
                    <RotateCcw className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                    <span>Position d’arrêt automatique</span>
                  </span>
                  <span aria-hidden="true" className="text-[#8f7c6b]">·</span>
                  <span className="font-mono font-semibold tabular-nums text-[#1c1e21]">
                    Chap. {String(savedPosition.chapterIndex + 1).padStart(2, '0')} · Seg.{' '}
                    {savedPosition.segmentIndex + 1}/{Math.max(1, savedPosition.totalSegments)}
                  </span>
                </div>
                <p className="text-xs font-medium text-[#2d3036]">
                  {savedPosition.chapterTitle}
                </p>
                {savedPosition.excerpt && (
                  <p className="line-clamp-1 text-xs text-[#55585e]">
                    « {savedPosition.excerpt} »
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => onResumeSavedPosition(false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-white px-3 py-1.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap transition-colors hover:bg-[#f1eee6] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                >
                  <ArrowUpRight className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                  <span>Aller ici</span>
                </button>
                <button
                  type="button"
                  onClick={() => onResumeSavedPosition(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#d9531e] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#c24515] focus-visible:outline-2 focus-visible:outline-[#1c1e21]"
                >
                  <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                  <span>Reprendre la lecture</span>
                </button>
              </div>
            </div>
          )}

          {bookmarks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#cdc7ba] bg-[#f2efe8] px-6 py-8 text-center">
              <Bookmark className="h-6 w-6 text-[#6b6d73]" aria-hidden="true" />
              <p className="mt-2.5 font-display text-sm font-semibold text-[#1c1e21]">
                Aucun marque-page manuel ajouté
              </p>
              <p className="mt-1 max-w-md text-xs text-[#5b5e64]">
                Votre position d’arrêt ci-dessus est retenue automatiquement. Cliquez sur « Marquer ce passage » dans la liseuse ou « Repère » sur le Walkman pour enregistrer d’autres passages favoris.
              </p>
            </div>
          ) : (
            <ul
              data-testid="bookmarks-list"
              className="divide-y divide-[#e6e1d7] rounded-xl border border-[#e0dbd0] bg-white"
            >
              {bookmarks.map((bm) => (
                <li
                  key={bm.id}
                  data-testid="bookmark-item"
                  className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5b5e64]">
                      <span className="font-mono font-semibold tabular-nums text-[#b93e0e]">
                        Chap. {String(bm.chapterIndex + 1).padStart(2, '0')}
                      </span>
                      <span className="font-display font-semibold text-[#1c1e21]">
                        {bm.chapterTitle}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Segment {bm.segmentIndex + 1} / {Math.max(1, bm.totalSegments)}
                      </span>
                    </div>

                    <p className="text-sm leading-relaxed text-[#2d3036]">
                      « {bm.excerpt} »
                    </p>

                    <div className="pt-0.5">
                      <label htmlFor={`note-${bm.id}`} className="sr-only">
                        Note du marque-page
                      </label>
                      <input
                        id={`note-${bm.id}`}
                        type="text"
                        value={bm.note}
                        maxLength={140}
                        onChange={(e) => onUpdateBookmarkNote(bm.id, e.target.value)}
                        placeholder="Ajouter une note de session (optionnel)…"
                        className="w-full max-w-md rounded-md border border-[#e0dbd0] bg-[#faf9f5] px-2.5 py-1 text-xs text-[#1c1e21] placeholder:text-[#8c887f] focus:border-[#d9531e] focus:bg-white focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onJumpToBookmark(bm, false)}
                      aria-label={`Aller au passage du chapitre ${bm.chapterIndex + 1}, segment ${bm.segmentIndex + 1}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-[#f7f5f0] px-3 py-1.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap transition-colors hover:bg-[#ece8df] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                    >
                      <ArrowUpRight className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                      <span>Aller au passage</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onJumpToBookmark(bm, true)}
                      aria-label={`Écouter à partir du chapitre ${bm.chapterIndex + 1}, segment ${bm.segmentIndex + 1}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#1c1e21] px-3 py-1.5 text-xs font-semibold text-[#f7f5f0] whitespace-nowrap transition-colors hover:bg-[#31343a] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                    >
                      <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                      <span>Écouter</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteBookmark(bm.id)}
                      aria-label={`Supprimer le marque-page du chapitre ${bm.chapterIndex + 1}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e0dbd0] bg-white text-[#5b5e64] transition-colors hover:border-[#d49a89] hover:bg-[#fbefeb] hover:text-[#8a280b] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
