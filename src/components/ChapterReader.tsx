import {
  Bookmark,
  BookmarkCheck,
  BookOpenText,
  ChevronLeft,
  ChevronRight,
  Languages,
  Loader2,
  Play,
} from 'lucide-react';
import { useState } from 'react';
import type { BookSession, BookmarkItem, ChapterItem } from '../types/walkman';
import { stripParasiticCharacters } from '../utils/speechSanitizer';

interface ChapterReaderProps {
  session: BookSession | null;
  activeChapter: ChapterItem | null;
  activeChapterIndex: number;
  activeSegmentIndex: number;
  isPlaying: boolean;
  autoTranslateToFrench: boolean;
  bookmarks: BookmarkItem[];
  onTranslateChapter: (chapterIndex: number) => void;
  onSelectSegment: (segmentIndex: number, autoPlay: boolean) => void;
  onAddBookmark: (note?: string) => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
}

export function ChapterReader({
  session,
  activeChapter,
  activeChapterIndex,
  activeSegmentIndex,
  isPlaying,
  autoTranslateToFrench,
  bookmarks,
  onTranslateChapter,
  onSelectSegment,
  onAddBookmark,
  onPrevChapter,
  onNextChapter,
}: ChapterReaderProps) {
  const [noteInput, setNoteInput] = useState('');
  const [showNoteComposer, setShowNoteComposer] = useState(false);

  if (!session || !activeChapter) {
    return (
      <section
        id="liseuse"
        aria-label="Liseuse française synchronisée"
        className="rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-6"
      >
        <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight text-[#1c1e21]">
              Liseuse française
            </h2>
            <p className="mt-0.5 text-xs text-[#5b5e64]">
              Affiche le texte français du chapitre actif, synchronisé avec la lecture et les marque-pages
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center justify-center rounded-xl border border-dashed border-[#cdc7ba] bg-[#f2efe8] px-6 py-8 text-center">
          <BookOpenText className="h-7 w-7 text-[#6b6d73]" aria-hidden="true" />
          <p className="mt-3 font-display text-base font-semibold text-[#1c1e21]">
            Prêt pour la lecture en français
          </p>
          <p className="mt-1 max-w-lg text-sm text-[#5b5e64]">
            Importez un livre français ou anglais (PDF, EPUB, TXT) ou collez votre texte ci-dessus. Les textes anglais sont traduits en français chapitre par chapitre et affichés ici en version française uniquement.
          </p>
        </div>
      </section>
    );
  }

  const totalChapters = session.chapters.length;
  const isUntranslated = activeChapter.translationStatus === 'needs_translation';
  const isTranslating = activeChapter.translationStatus === 'translating';
  const isTranslated = activeChapter.translationStatus === 'translated';
  const isReadyInFrench = !isUntranslated && !isTranslating;

  const chapterBookmarks = bookmarks.filter((bm) => bm.chapterIndex === activeChapterIndex);
  const currentSegmentBookmarked = chapterBookmarks.some(
    (bm) => bm.segmentIndex === activeSegmentIndex
  );

  const displayedHeading = isUntranslated
    ? `Chapitre ${activeChapterIndex + 1} — en attente de traduction`
    : activeChapter.title;

  const handleConfirmBookmark = (e: React.FormEvent) => {
    e.preventDefault();
    onAddBookmark(noteInput.trim());
    setNoteInput('');
    setShowNoteComposer(false);
  };

  return (
    <section
      id="liseuse"
      aria-label="Liseuse française du chapitre actif"
      data-testid="chapter-reader"
      className="rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-4 sm:p-6"
    >
      {/* Reader Header */}
      <div className="flex flex-col gap-3 border-b border-[#e2ddd3] pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#55585e]">
            <span className="font-mono font-semibold tabular-nums text-[#1c1e21]">
              Chapitre {String(activeChapterIndex + 1).padStart(2, '0')} /{' '}
              {String(totalChapters).padStart(2, '0')}
            </span>
            <span aria-hidden="true">·</span>
            {isTranslated && (
              <span className="font-medium text-[#2c5e3b]">Traduit en français</span>
            )}
            {activeChapter.translationStatus === 'french_native' && (
              <span>Texte en français</span>
            )}
            {isTranslating && (
              <span className="font-medium text-[#b93e0e]">Traduction en cours…</span>
            )}
            {isUntranslated && (
              <span className="font-medium text-[#55585e]">Source anglaise détectée</span>
            )}
            {isReadyInFrench && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Segment {activeSegmentIndex + 1} / {Math.max(1, activeChapter.segments.length)}
                </span>
              </>
            )}
          </p>

          <h2
            data-testid="reader-chapter-title"
            className="mt-1 font-display text-xl font-bold tracking-tight text-[#1c1e21]"
          >
            {displayedHeading}
          </h2>
        </div>

        {/* Bookmark & Translation Controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isReadyInFrench && (
            <>
              <button
                type="button"
                onClick={() => onAddBookmark()}
                data-testid="reader-bookmark-button"
                aria-label="Marquer le passage en cours"
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] ${
                  currentSegmentBookmarked
                    ? 'border border-[#c7b39f] bg-[#f0e7da] text-[#8f2e08] hover:bg-[#eadcc8]'
                    : 'bg-[#1c1e21] text-[#f7f5f0] hover:bg-[#31343a]'
                }`}
              >
                {currentSegmentBookmarked ? (
                  <BookmarkCheck className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>
                  {currentSegmentBookmarked ? 'Passage marqué' : 'Marquer ce passage'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowNoteComposer((open) => !open)}
                className="rounded-lg border border-[#cfc9bd] bg-white px-3 py-2 text-xs font-medium text-[#35383d] whitespace-nowrap transition-colors hover:bg-[#efece4] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
              >
                {showNoteComposer ? 'Fermer la note' : 'Avec note'}
              </button>
            </>
          )}

          {isReadyInFrench && session.detectedLanguage === 'fr' && !isTranslated && (
            <button
              type="button"
              onClick={() => onTranslateChapter(activeChapterIndex)}
              title="Traduire ce chapitre de l'anglais vers le français"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-white px-3 py-2 text-xs font-medium text-[#35383d] whitespace-nowrap transition-colors hover:bg-[#efece4] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
            >
              <Languages className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
              <span>Traduire EN → FR</span>
            </button>
          )}
        </div>
      </div>

      {/* Inline Bookmark Note Composer (no window.prompt) */}
      {showNoteComposer && isReadyInFrench && (
        <form
          onSubmit={handleConfirmBookmark}
          className="mt-4 flex flex-col gap-2 rounded-xl border border-[#dcd7cc] bg-[#efece4] p-3 sm:flex-row sm:items-center"
        >
          <label htmlFor="bookmark-note-input" className="sr-only">
            Note facultative pour ce marque-page
          </label>
          <input
            id="bookmark-note-input"
            type="text"
            value={noteInput}
            maxLength={140}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder={`Note sur le segment ${activeSegmentIndex + 1} (ex. : citation clé, reprise demain)…`}
            className="flex-1 rounded-lg border border-[#cfc9bd] bg-white px-3 py-2 text-sm text-[#1c1e21] placeholder:text-[#8c887f] focus:border-[#d9531e] focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#d9531e] px-4 py-2 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#c24515] focus-visible:outline-2 focus-visible:outline-[#1c1e21]"
          >
            Enregistrer le marque-page
          </button>
        </form>
      )}

      {/* Reader Body (French-only editorial display) */}
      <div className="mt-5">
        {isTranslating ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center rounded-xl border border-[#e0dbd0] bg-white px-6 py-12 text-center"
          >
            <Loader2 className="h-6 w-6 animate-spin text-[#d9531e]" aria-hidden="true" />
            <p className="mt-3 font-display text-base font-semibold text-[#1c1e21]">
              Traduction du chapitre en français…
            </p>
            <p className="mt-1 max-w-md text-xs text-[#5b5e64]">
              Mise en forme naturelle en français pour la lecture à voix haute. Rien n&apos;est enregistré sur le serveur.
            </p>
          </div>
        ) : isUntranslated ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#e0dbd0] bg-white px-6 py-10 text-center">
            <Languages className="h-7 w-7 text-[#d9531e]" aria-hidden="true" />
            <p className="mt-3 font-display text-base font-semibold text-[#1c1e21]">
              Ce chapitre est en anglais
            </p>
            <p className="mt-1 max-w-md text-sm text-[#5b5e64]">
              La liseuse affiche uniquement le texte traduit en français. Cliquez ci-dessous pour traduire ce chapitre
              {autoTranslateToFrench
                ? ', ou appuyez directement sur PLAY pour le traduire et l’écouter immédiatement.'
                : '.'}
            </p>
            <button
              type="button"
              onClick={() => onTranslateChapter(activeChapterIndex)}
              data-testid="translate-active-chapter-button"
              className="mech-key-orange mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c1e21]"
            >
              <Languages className="h-4 w-4" aria-hidden="true" />
              <span>Traduire ce chapitre en français</span>
            </button>
          </div>
        ) : (
          <div
            data-testid="reader-french-content"
            className="max-h-[65vh] overflow-y-auto rounded-xl border border-[#e0dbd0] bg-white px-4 py-4 sm:max-h-[420px] sm:px-8 sm:py-6"
          >
            <div className="mx-auto max-w-[70ch] space-y-3">
              {activeChapter.segments.map((segmentText, segIdx) => {
                const isActiveSeg = segIdx === activeSegmentIndex;
                const segBookmarked = chapterBookmarks.some((bm) => bm.segmentIndex === segIdx);
                const cleanedSegment = stripParasiticCharacters(segmentText);
                const paragraphs = cleanedSegment
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean);

                return (
                  <div
                    key={`${activeChapter.id}-seg-${segIdx}`}
                    data-testid={`reader-segment-${segIdx}`}
                    data-active-segment={isActiveSeg ? 'true' : 'false'}
                    className={`group rounded-xl px-4 py-3 transition-colors ${
                      isActiveSeg
                        ? 'bg-[#f4ece0] ring-1 ring-[#d9531e]/35'
                        : 'hover:bg-[#faf8f4]'
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-[#6d7076]">
                      <span className="font-mono tabular-nums">
                        Segment {segIdx + 1} / {activeChapter.segments.length}
                        {isActiveSeg && isPlaying ? ' · En lecture' : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        {segBookmarked && (
                          <span className="inline-flex items-center gap-1 font-medium text-[#b93e0e]">
                            <BookmarkCheck className="h-3 w-3" aria-hidden="true" />
                            <span>Marqué</span>
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onSelectSegment(segIdx, true)}
                          aria-label={`Lire à partir du segment ${segIdx + 1}`}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-[#35383d] transition-colors hover:bg-[#e8e3d8] hover:text-[#1c1e21] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
                        >
                          <Play className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                          <span>Lire ici</span>
                        </button>
                      </div>
                    </div>

                    <div
                      onClick={() => onSelectSegment(segIdx, false)}
                      className="cursor-pointer space-y-3 text-[15.5px] leading-[1.75] text-[#1f2125]"
                    >
                      {paragraphs.map((para, pIdx) => (
                        <p key={pIdx}>{para}</p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Chapter Pagination Footer inside Reader */}
      {totalChapters > 1 && (
        <div className="mt-4 flex items-center justify-between gap-3 pt-1">
          <button
            type="button"
            onClick={onPrevChapter}
            disabled={activeChapterIndex <= 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-white px-3.5 py-2 text-xs font-medium text-[#1c1e21] transition-colors hover:bg-[#efece4] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span>Chapitre précédent</span>
          </button>

          <span className="font-mono text-xs tabular-nums text-[#5b5e64]">
            {activeChapterIndex + 1} / {totalChapters}
          </span>

          <button
            type="button"
            onClick={onNextChapter}
            disabled={activeChapterIndex >= totalChapters - 1}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#cfc9bd] bg-white px-3.5 py-2 text-xs font-medium text-[#1c1e21] transition-colors hover:bg-[#efece4] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span>Chapitre suivant</span>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
