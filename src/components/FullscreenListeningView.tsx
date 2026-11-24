import {
  Bookmark,
  BookmarkCheck,
  Eye,
  EyeOff,
  FastForward,
  Languages,
  Minimize2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  BookSession,
  ChapterItem,
  TransportState,
} from '../types/walkman';
import { DEFAULT_PAUSE_DURATION_SECONDS } from '../utils/audioDsp';
import { formatPitchLabel, formatTimecode } from '../utils/bookSplitter';
import { stripParasiticCharacters } from '../utils/speechSanitizer';

interface FullscreenListeningViewProps {
  session: BookSession | null;
  activeChapter: ChapterItem | null;
  activeChapterIndex: number;
  transportState: TransportState;
  activeSegmentIndex: number;
  totalSegmentsInChapter: number;
  segmentCurrentTime: number;
  segmentDuration: number;
  chapterProgressRatio: number;
  speed: number;
  pitchSemitones: number;
  pauseDurationSeconds: number;
  volume: number;
  muted: boolean;
  isExporting: boolean;
  isTranslating: boolean;
  isCurrentSegmentBookmarked: boolean;
  errorMessage: string | null;
  onExitFullscreen: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onFastForward: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onSeekSegment: (seconds: number) => void;
  onSpeedChange: (speed: number) => void;
  onPitchChange: (semitones: number) => void;
  onPauseDurationChange: (seconds: number) => void;
  onResetTuning: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onAddBookmark: () => void;
  onTranslateActiveChapter: () => void;
}

const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5];

export function FullscreenListeningView({
  session,
  activeChapter,
  activeChapterIndex,
  transportState,
  activeSegmentIndex,
  totalSegmentsInChapter,
  segmentCurrentTime,
  segmentDuration,
  chapterProgressRatio,
  speed,
  pitchSemitones,
  pauseDurationSeconds,
  volume,
  muted,
  isExporting,
  isTranslating,
  isCurrentSegmentBookmarked,
  errorMessage,
  onExitFullscreen,
  onPlay,
  onPause,
  onStop,
  onRewind,
  onFastForward,
  onPrevChapter,
  onNextChapter,
  onPrevSegment,
  onNextSegment,
  onSeekSegment,
  onSpeedChange,
  onPitchChange,
  onPauseDurationChange,
  onResetTuning,
  onVolumeChange,
  onToggleMute,
  onAddBookmark,
  onTranslateActiveChapter,
}: FullscreenListeningViewProps) {
  const [showExcerpt, setShowExcerpt] = useState(true);
  const [showTuning, setShowTuning] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onExitFullscreen();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onExitFullscreen]);

  const isPlaying = transportState === 'playing';
  const isBuffering = transportState === 'buffering';
  const hasBook = Boolean(session && activeChapter);
  const totalChapters = session?.chapters.length ?? 0;
  const isUntranslated = activeChapter?.translationStatus === 'needs_translation';

  const rawActiveSegment =
    !isUntranslated && activeChapter
      ? activeChapter.segments[activeSegmentIndex] ?? ''
      : '';

  const activeParagraphs = useMemo(() => {
    if (!rawActiveSegment) return [];
    return stripParasiticCharacters(rawActiveSegment)
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
  }, [rawActiveSegment]);

  const isTuningModified =
    Math.abs(speed - 1.0) > 0.01 ||
    Math.abs(pitchSemitones) > 0.05 ||
    Math.abs(pauseDurationSeconds - DEFAULT_PAUSE_DURATION_SECONDS) > 0.01;

  const statusText = isExporting
    ? 'Export MP3…'
    : isTranslating
      ? 'Traduction…'
      : isBuffering
        ? 'Préparation…'
        : isPlaying
          ? 'Lecture'
          : transportState === 'paused'
            ? 'Pause'
            : hasBook
              ? 'Prêt'
              : 'Aucun livre';

  const chapterTitle = isUntranslated
    ? `Chapitre ${activeChapterIndex + 1} (anglais — à traduire)`
    : activeChapter?.title ?? 'Aucun chapitre actif';

  return (
    <section
      data-testid="fullscreen-listening-view"
      aria-label="Mode écoute plein écran"
      className="flex min-h-screen flex-col bg-[#16181b] text-[#f4f1ea]"
    >
      {/* Top minimal bar */}
      <header className="border-b border-[#2b2e35] px-4 py-3 sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-wider text-[#f07645]">
              Mode écoute · Animations suspendues
            </p>
            <p className="truncate font-display text-sm font-bold text-[#f4f1ea] sm:text-base">
              {session?.title ?? 'Sonobande'}
            </p>
          </div>

          <button
            type="button"
            onClick={onExitFullscreen}
            data-testid="exit-fullscreen-btn"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#454952] bg-[#25282e] px-3.5 py-2 text-xs font-semibold text-[#f4f1ea] transition-colors hover:bg-[#32363e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
          >
            <Minimize2 className="h-4 w-4 text-[#f07645]" aria-hidden="true" />
            <span>Quitter le plein écran</span>
          </button>
        </div>
      </header>

      {/* Main focused listening body */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-between gap-6 px-4 py-6 sm:px-8 sm:py-8">
        {/* Chapter header + status */}
        <div className="space-y-2 text-center">
          <p className="font-mono text-xs tabular-nums text-[#a6aab3]">
            {hasBook
              ? `Chapitre ${activeChapterIndex + 1} / ${totalChapters} · Segment ${activeSegmentIndex + 1} / ${Math.max(1, totalSegmentsInChapter)} · ${statusText}`
              : 'Aucun document chargé'}
          </p>
          <h1 className="font-display text-2xl font-bold tracking-tight text-[#f7f5f0] sm:text-3xl">
            {chapterTitle}
          </h1>

          {/* Lightweight chapter progress indicator */}
          <div className="mx-auto mt-3 flex max-w-md items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#2a2d34]">
              <div
                className="h-full bg-[#d9531e]"
                style={{ width: `${Math.round(chapterProgressRatio * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs tabular-nums text-[#b5b9c2]">
              {Math.round(chapterProgressRatio * 100)}%
            </span>
          </div>
        </div>

        {/* Error alert if any */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-[#7c3523] bg-[#2b1a16] px-4 py-3 text-center text-xs text-[#f6bdb0]"
          >
            {errorMessage}
          </div>
        )}

        {/* Active passage only (single segment in DOM — no full-chapter list) */}
        <div className="flex flex-1 flex-col justify-center">
          {!hasBook ? (
            <div className="rounded-2xl border border-[#2c2f36] bg-[#1e2126] p-8 text-center text-sm text-[#a6aab3]">
              Quittez le plein écran pour importer un livre ou coller un texte.
            </div>
          ) : isUntranslated ? (
            <div className="rounded-2xl border border-[#3a332b] bg-[#211f1c] p-6 text-center">
              <p className="text-sm text-[#ddd8ce]">
                Ce chapitre est en anglais et doit être traduit en français avant l’écoute.
              </p>
              <button
                type="button"
                onClick={onTranslateActiveChapter}
                disabled={isTranslating}
                className="mech-key-orange mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-45"
              >
                <Languages className="h-4 w-4" aria-hidden="true" />
                <span>Traduire ce chapitre en français</span>
              </button>
            </div>
          ) : showExcerpt ? (
            <div
              data-testid="fullscreen-active-segment"
              className="rounded-2xl border border-[#2c2f36] bg-[#1d2025] px-5 py-6 sm:px-8 sm:py-7"
            >
              <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-[#9fa3ab]">
                <span className="font-mono tabular-nums">
                  Passage actif ({activeSegmentIndex + 1}/{Math.max(1, totalSegmentsInChapter)})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onPrevSegment}
                    disabled={activeSegmentIndex <= 0 || isExporting}
                    className="rounded border border-[#393d45] bg-[#25282f] px-2 py-0.5 text-[11px] text-[#dcdedf] hover:bg-[#31353e] disabled:opacity-35"
                  >
                    Seg. préc.
                  </button>
                  <button
                    type="button"
                    onClick={onNextSegment}
                    disabled={activeSegmentIndex >= totalSegmentsInChapter - 1 || isExporting}
                    className="rounded border border-[#393d45] bg-[#25282f] px-2 py-0.5 text-[11px] text-[#dcdedf] hover:bg-[#31353e] disabled:opacity-35"
                  >
                    Seg. suiv.
                  </button>
                </div>
              </div>
              <div className="max-h-[36vh] space-y-3 overflow-y-auto pr-1 text-base leading-relaxed text-[#f2efe8] sm:text-lg">
                {activeParagraphs.length > 0 ? (
                  activeParagraphs.map((para, index) => <p key={index}>{para}</p>)
                ) : (
                  <p className="text-sm text-[#9fa3ab]">Prêt pour la lecture.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-[#2a2d34] bg-[#1b1d22] px-6 py-8 text-center text-xs text-[#9fa3ab]">
              Texte masqué pour une écoute sans distraction.
            </div>
          )}
        </div>

        {/* Transport deck + scrubber + compact utility bar */}
        <div className="space-y-4 rounded-2xl border border-[#2e3138] bg-[#1e2126] p-4 sm:p-5">
          {/* Segment scrubber & timecode */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-xs tabular-nums text-[#b5b9c2]">
              <span>{formatTimecode(segmentCurrentTime)}</span>
              <span>{formatTimecode(segmentDuration)}</span>
            </div>
            <label htmlFor="fullscreen-scrubber" className="sr-only">
              Position dans le segment audio
            </label>
            <input
              id="fullscreen-scrubber"
              type="range"
              min={0}
              max={Math.max(0.1, segmentDuration)}
              step={0.1}
              value={Math.min(segmentCurrentTime, segmentDuration || 0)}
              disabled={!hasBook || segmentDuration <= 0}
              onChange={(e) => onSeekSegment(Number(e.target.value))}
              className="walkman-fader w-full disabled:opacity-40"
            />
          </div>

          {/* Primary transport buttons */}
          <div
            role="group"
            aria-label="Commandes de lecture plein écran"
            className="grid grid-cols-3 gap-2 sm:grid-cols-6"
          >
            <button
              type="button"
              onClick={onPrevChapter}
              disabled={!hasBook || activeChapterIndex <= 0}
              aria-label="Chapitre précédent"
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-[#3a3e47] bg-[#262a31] px-2 py-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#31363f] disabled:opacity-35"
            >
              <SkipBack className="h-4 w-4" aria-hidden="true" />
              <span>PRÉC.</span>
            </button>

            <button
              type="button"
              onClick={onRewind}
              disabled={!hasBook || isExporting}
              aria-label="Retour rapide"
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-[#3a3e47] bg-[#262a31] px-2 py-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#31363f] disabled:opacity-35"
            >
              <Rewind className="h-4 w-4" aria-hidden="true" />
              <span>REW</span>
            </button>

            {isPlaying || isBuffering ? (
              <button
                type="button"
                onClick={onPause}
                disabled={!hasBook}
                aria-label="Mettre en pause"
                className="mech-key-orange flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-white disabled:opacity-45"
              >
                <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>PAUSE</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPlay}
                disabled={!hasBook || isExporting}
                aria-label="Lire le chapitre actif"
                className="mech-key-orange flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-white disabled:opacity-45"
              >
                <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                <span>PLAY</span>
              </button>
            )}

            <button
              type="button"
              onClick={onStop}
              disabled={!hasBook}
              aria-label="Arrêter"
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-[#3a3e47] bg-[#262a31] px-2 py-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#31363f] disabled:opacity-35"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              <span>STOP</span>
            </button>

            <button
              type="button"
              onClick={onFastForward}
              disabled={!hasBook || isExporting}
              aria-label="Avance rapide"
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-[#3a3e47] bg-[#262a31] px-2 py-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#31363f] disabled:opacity-35"
            >
              <FastForward className="h-4 w-4" aria-hidden="true" />
              <span>FF</span>
            </button>

            <button
              type="button"
              onClick={onNextChapter}
              disabled={!hasBook || activeChapterIndex >= totalChapters - 1}
              aria-label="Chapitre suivant"
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border border-[#3a3e47] bg-[#262a31] px-2 py-2 text-xs font-semibold text-[#f4f1ea] hover:bg-[#31363f] disabled:opacity-35"
            >
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              <span>SUIV.</span>
            </button>
          </div>

          {/* Volume + Bookmark + Text/Tuning toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2d3037] pt-3">
            <div className="flex min-w-[180px] flex-1 items-center gap-2">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Réactiver le son' : 'Couper le son'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#3a3e47] bg-[#25282f] text-[#f4f1ea] hover:bg-[#32363f]"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <label htmlFor="fullscreen-volume" className="sr-only">
                Volume
              </label>
              <input
                id="fullscreen-volume"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => onVolumeChange(Number(e.target.value))}
                className="walkman-fader w-full"
              />
              <span className="w-9 text-right font-mono text-xs tabular-nums text-[#b5b9c2]">
                {Math.round((muted ? 0 : volume) * 100)}%
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAddBookmark}
                disabled={!hasBook || isUntranslated}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                  isCurrentSegmentBookmarked
                    ? 'border-[#d9531e] bg-[#2f221d] text-[#f8c1aa]'
                    : 'border-[#3a3e47] bg-[#25282f] text-[#f4f1ea] hover:bg-[#32363f]'
                }`}
              >
                {isCurrentSegmentBookmarked ? (
                  <BookmarkCheck className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Repère</span>
              </button>

              <button
                type="button"
                onClick={() => setShowExcerpt((prev) => !prev)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#3a3e47] bg-[#25282f] px-2.5 py-1.5 text-xs font-medium text-[#f4f1ea] hover:bg-[#32363f]"
              >
                {showExcerpt ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>{showExcerpt ? 'Masquer texte' : 'Afficher texte'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTuning((prev) => !prev)}
                aria-expanded={showTuning}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                  showTuning
                    ? 'border-[#d9531e] bg-[#2f221d] text-[#f8c1aa]'
                    : 'border-[#3a3e47] bg-[#25282f] text-[#f4f1ea] hover:bg-[#32363f]'
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Réglages ({speed.toFixed(2)}×)</span>
              </button>
            </div>
          </div>

          {/* Optional tuning drawer (mounted only when opened) */}
          {showTuning && (
            <div className="space-y-3 border-t border-[#2d3037] pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#e6e2da]">Vitesse, hauteur et pauses</span>
                {isTuningModified && (
                  <button
                    type="button"
                    onClick={onResetTuning}
                    className="inline-flex items-center gap-1 text-[#f07645] hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Réinitialiser</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1 flex justify-between text-[#c9cdd5]">
                    <label htmlFor="fs-speed">Vitesse</label>
                    <span className="font-mono tabular-nums">{speed.toFixed(2)}×</span>
                  </div>
                  <input
                    id="fs-speed"
                    type="range"
                    min={0.5}
                    max={2.0}
                    step={0.05}
                    value={speed}
                    onChange={(e) => onSpeedChange(Number(e.target.value))}
                    className="walkman-fader w-full"
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onSpeedChange(preset)}
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                          Math.abs(speed - preset) < 0.01
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3a3e47] bg-[#25282f] text-[#cfd3db]'
                        }`}
                      >
                        {preset.toFixed(2)}×
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[#c9cdd5]">
                    <label htmlFor="fs-pitch">Hauteur</label>
                    <span className="font-mono tabular-nums">{formatPitchLabel(pitchSemitones)}</span>
                  </div>
                  <input
                    id="fs-pitch"
                    type="range"
                    min={-6}
                    max={6}
                    step={0.5}
                    value={pitchSemitones}
                    onChange={(e) => onPitchChange(Number(e.target.value))}
                    className="walkman-fader w-full"
                  />
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[#c9cdd5]">
                    <label htmlFor="fs-pause">Pause ponctuation</label>
                    <span className="font-mono tabular-nums">{pauseDurationSeconds.toFixed(1)} s</span>
                  </div>
                  <input
                    id="fs-pause"
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={pauseDurationSeconds}
                    onChange={(e) => onPauseDurationChange(Number(e.target.value))}
                    className="walkman-fader w-full"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
