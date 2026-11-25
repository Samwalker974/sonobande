import {
  FastForward,
  Maximize2,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  Square,
} from 'lucide-react';

interface WalkmanQuickControlsProps {
  hasBook: boolean;
  isPlaying: boolean;
  isBuffering: boolean;
  isExporting: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onFastForward: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onEnterFullscreen: () => void;
}

export function WalkmanQuickControls({
  hasBook,
  isPlaying,
  isBuffering,
  isExporting,
  canGoPrevious,
  canGoNext,
  onPlay,
  onPause,
  onStop,
  onRewind,
  onFastForward,
  onPrevChapter,
  onNextChapter,
  onEnterFullscreen,
}: WalkmanQuickControlsProps) {
  const buttonClass =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#45484e] bg-[#2b2e33] text-[#f7f5f0] shadow-sm transition-colors hover:bg-[#3b3e44] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f7f5f0] disabled:cursor-not-allowed disabled:opacity-40';

  if (!hasBook) return null;

  return (
    <aside
      aria-label="Commandes rapides du Walkman"
      className="fixed inset-x-2 bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 mx-auto w-fit max-w-[calc(100vw-1rem)] overflow-x-auto rounded-xl border border-[#4c4f55] bg-[#1c1e21]/95 p-1 shadow-xl backdrop-blur-sm md:inset-x-auto md:right-2 md:top-1/2 md:bottom-auto md:mx-0 md:-translate-y-1/2"
    >
      <div
        role="group"
        aria-label="Transport audio"
        className="flex flex-row justify-center gap-0.5 md:flex-col md:justify-start"
      >
        <button
          type="button"
          onClick={onPrevChapter}
          disabled={!hasBook || !canGoPrevious}
          aria-label="Chapitre précédent"
          title="Chapitre précédent"
          className={buttonClass}
        >
          <SkipBack className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRewind}
          disabled={!hasBook || isExporting}
          aria-label="Retour rapide"
          title="Retour rapide"
          className={buttonClass}
        >
          <Rewind className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPlay}
          disabled={!hasBook || isExporting}
          aria-label="Lire le chapitre actif"
          title="Lire"
          className={`${buttonClass} border-[#9f350d] bg-[#d9531e] hover:bg-[#c24515]`}
        >
          <Play className="h-4 w-4 fill-current" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onPause}
          disabled={!hasBook || (!isPlaying && !isBuffering)}
          aria-label="Mettre la lecture en pause"
          title="Pause"
          className={buttonClass}
        >
          <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onStop}
          disabled={!hasBook}
          aria-label="Arrêter la lecture"
          title="Arrêter"
          className={buttonClass}
        >
          <Square className="h-4 w-4 fill-current" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onFastForward}
          disabled={!hasBook || isExporting}
          aria-label="Avance rapide"
          title="Avance rapide"
          className={buttonClass}
        >
          <FastForward className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNextChapter}
          disabled={!hasBook || !canGoNext}
          aria-label="Chapitre suivant"
          title="Chapitre suivant"
          className={buttonClass}
        >
          <SkipForward className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onEnterFullscreen}
          disabled={!hasBook}
          aria-label="Mode écoute plein écran"
          title="Mode écoute plein écran"
          className={buttonClass}
        >
          <Maximize2 className="h-4 w-4 text-[#f07645]" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
