import {
  Bookmark,
  BookOpen,
  HardDrive,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { SavedBookRecord } from '../types/walkman';
import { formatLongDuration, formatTimecode } from '../utils/bookSplitter';
import { formatStorageSizeFr } from '../utils/bookStorage';

interface BookLibraryProps {
  books: SavedBookRecord[];
  activeBookId: string | null;
  onResumeBook: (book: SavedBookRecord, autoPlay: boolean) => void;
  onDeleteBook: (bookId: string) => void;
}

const SOURCE_LABELS: Record<SavedBookRecord['session']['source'], string> = {
  pdf: 'PDF',
  epub: 'EPUB',
  txt: 'TXT',
  paste: 'Texte collé',
};

export function BookLibrary({
  books,
  activeBookId,
  onResumeBook,
  onDeleteBook,
}: BookLibraryProps) {
  return (
    <section
      id="bibliotheque"
      aria-label="Bibliothèque des livres sauvegardés dans le navigateur"
      className="rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-2 border-b border-[#e2ddd3] pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-[#1c1e21] sm:text-xl">
            Ma Bibliothèque ({books.length})
          </h2>
          <p className="mt-0.5 text-xs text-[#55585e]">
            Texte et marque-page d’arrêt enregistrés localement dans votre navigateur · Aucun MP3 stocké
          </p>
        </div>

        <div className="inline-flex items-center gap-1.5 text-xs text-[#55585e]">
          <HardDrive className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
          <span className="font-mono tabular-nums">
            {formatStorageSizeFr(books.reduce((sum, b) => sum + b.textSizeBytes, 0))} utilisés (texte seul)
          </span>
        </div>
      </div>

      {books.length === 0 ? (
        <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#cdc7ba] bg-[#f2efe8] px-6 py-8 text-center">
          <BookOpen className="h-6 w-6 text-[#6b6d73]" aria-hidden="true" />
          <p className="mt-2.5 font-display text-sm font-semibold text-[#1c1e21]">
            Votre bibliothèque locale est vide
          </p>
          <p className="mt-1 max-w-md text-xs text-[#5b5e64]">
            Chaque livre importé (PDF, EPUB, TXT) ou texte collé est ajouté ici automatiquement avec sa position d’arrêt pour reprendre exactement là où vous en étiez.
          </p>
        </div>
      ) : (
        <ul
          data-testid="saved-books-list"
          className="mt-4 divide-y divide-[#e6e1d7] rounded-xl border border-[#e0dbd0] bg-white"
        >
          {books.map((book) => {
            const isActive = book.id === activeBookId;
            const pos = book.lastPosition;
            const totalChapters = book.session.chapters.length;

            return (
              <li
                key={book.id}
                data-testid="saved-book-item"
                className={`flex flex-col gap-3 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                  isActive ? 'bg-[#fbf7f2]' : 'hover:bg-[#faf8f4]'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                    <button
                      type="button"
                      onClick={() => onResumeBook(book, false)}
                      className="truncate text-left font-display text-sm font-bold text-[#1c1e21] hover:text-[#b93e0e] focus-visible:outline-2 focus-visible:outline-[#d9531e] sm:text-base"
                    >
                      {book.session.title}
                    </button>
                    {isActive && (
                      <span className="font-mono text-[11px] font-semibold text-[#b93e0e]">
                        · Ouvert dans le lecteur
                      </span>
                    )}
                  </div>

                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#5b5e64]">
                    <span>{SOURCE_LABELS[book.session.source]}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {book.session.detectedLanguage === 'en' ? 'EN → FR' : 'Français'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {totalChapters} {totalChapters > 1 ? 'chapitres' : 'chapitre'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      ~{formatLongDuration(book.session.totalEstimatedSeconds)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">
                      {formatStorageSizeFr(book.textSizeBytes)}
                    </span>
                    {book.bookmarks.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {book.bookmarks.length}{' '}
                          {book.bookmarks.length > 1 ? 'repères' : 'repère'}
                        </span>
                      </>
                    )}
                  </p>

                  {/* Auto-saved stop bookmark */}
                  <div
                    data-testid="book-stop-position"
                    className="flex items-start gap-1.5 pt-0.5 text-xs text-[#3b3e44]"
                  >
                    <Bookmark
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d9531e]"
                      aria-hidden="true"
                    />
                    <p className="line-clamp-1">
                      <span className="font-semibold text-[#1c1e21]">
                        Arrêté · Chap. {String(pos.chapterIndex + 1).padStart(2, '0')} · Seg.{' '}
                        {pos.segmentIndex + 1}/{Math.max(1, pos.totalSegments)}
                        {pos.offsetSeconds && pos.offsetSeconds > 0
                          ? ` · ${formatTimecode(pos.offsetSeconds)}`
                          : ''}
                      </span>
                      {pos.excerpt && (
                        <span className="text-[#5b5e64]"> — « {pos.excerpt} »</span>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onResumeBook(book, true)}
                    data-testid="resume-book-play-btn"
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] ${
                      isActive
                        ? 'bg-[#d9531e] text-white hover:bg-[#c24515]'
                        : 'bg-[#1c1e21] text-[#f7f5f0] hover:bg-[#31343a]'
                    }`}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
                    <span>Reprendre</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onResumeBook(book, false)}
                    data-testid="open-book-position-btn"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-[#f7f5f0] px-3 py-1.5 text-xs font-medium text-[#25272b] whitespace-nowrap transition-colors hover:bg-[#ece8df] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                  >
                    <RotateCcw className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                    <span>Ouvrir au repère</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteBook(book.id)}
                    aria-label={`Supprimer « ${book.session.title} » du navigateur`}
                    data-testid="delete-saved-book-btn"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e0dbd0] bg-white text-[#5b5e64] transition-colors hover:border-[#d49a89] hover:bg-[#fbefeb] hover:text-[#8a280b] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
