import {
  Bookmark,
  BookmarkCheck,
  Disc3,
  Eye,
  EyeOff,
  FastForward,
  Languages,
  Loader2,
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
  const isPaused = transportState === 'paused';
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
          : isPaused
            ? 'Pause'
            : hasBook
              ? segmentCurrentTime > 0
                ? 'Arrêté (reprise prête)'
                : 'Prêt'
              : 'Aucun livre';

  const chapterTitle = isUntranslated
    ? `Chapitre ${activeChapterIndex + 1} (anglais — à traduire)`
    : activeChapter?.title ?? 'Aucun chapitre actif';

  const effectiveDuration = Math.max(segmentDuration, segmentCurrentTime);

  return (
    <section
      data-testid="fullscreen-listening-view"
      aria-label="Mode écoute plein écran"
      className="walkman-retro-chassis flex min-h-screen flex-col text-[#f4f1ea]"
    >
      {/* Retro Brushed Gunmetal Header Bezel */}
      <header className="border-b-2 border-[#2d3038] bg-[#1a1c21]/95 px-4 py-3 shadow-md sm:px-8">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#4a4e59] bg-[#24272e] text-[#d9531e] shadow-inner"
              aria-hidden="true"
            >
              <Disc3 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-display text-sm font-bold tracking-[0.18em] text-[#f4f1ea]">
                  SONOBANDE
                </span>
                <span className="hidden rounded border border-[#b5945b]/45 bg-[#2a241b] px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider text-[#d9b87c] sm:inline">
                  STEREO · C-90
                </span>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#9fa4ae]">
                Mode écoute plein écran · Position mémorisée
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onExitFullscreen}
            data-testid="exit-fullscreen-btn"
            className="mech-key-dark inline-flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
          >
            <Minimize2 className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
            <span>Quitter le plein écran</span>
          </button>
        </div>
      </header>

      {/* Main Retro Listening Stage */}
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-between gap-5 px-4 py-5 sm:px-8 sm:py-7">
        {/* Exact Requested Hierarchy Below Header:
            1. Titre du livre
            2. Chapitre X / Y · Segment A / B · Statut
            3. Nom du Chapitre */}
        <div className="walkman-retro-panel relative overflow-hidden rounded-2xl px-5 py-5 text-center sm:px-7 sm:py-6">
          {/* Signature Walkman orange top cassette stripe */}
          <div
            className="absolute inset-x-0 top-0 h-1.5"
            style={{
              background: 'linear-gradient(90deg, #b93e0e 0%, #d9531e 48%, #b5945b 100%)',
            }}
            aria-hidden="true"
          />

          {/* Decorative corner hardware screws */}
          <span
            aria-hidden="true"
            className="absolute top-3.5 left-3.5 h-2 w-2 rounded-full border border-[#4f5460] bg-[#17191d]"
          />
          <span
            aria-hidden="true"
            className="absolute top-3.5 right-3.5 h-2 w-2 rounded-full border border-[#4f5460] bg-[#17191d]"
          />

          {/* 1. Titre du livre */}
          <h1
            data-testid="fullscreen-book-title"
            className="font-display text-xl font-bold tracking-tight text-[#f7f4ec] sm:text-2xl"
          >
            {session?.title ?? 'Sonobande'}
          </h1>

          {/* 2. Chapitre X / Y · Segment A / B · Pause / Lecture */}
          <div className="mt-3 flex justify-center">
            <p
              data-testid="fullscreen-chapter-status"
              className="retro-lcd-window inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg px-3.5 py-1.5 font-mono text-xs font-medium tabular-nums text-[#e8c68d]"
            >
              {isBuffering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#f07645]" aria-hidden="true" />
              ) : (
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isPlaying
                      ? 'bg-[#d9531e]'
                      : isPaused
                        ? 'bg-[#d9b87c]'
                        : 'bg-[#6c717c]'
                  }`}
                  aria-hidden="true"
                />
              )}
              <span>
                {hasBook
                  ? `Chapitre ${activeChapterIndex + 1} / ${totalChapters} · Segment ${activeSegmentIndex + 1} / ${Math.max(1, totalSegmentsInChapter)} · ${statusText}`
                  : 'Aucun document chargé'}
              </span>
            </p>
          </div>

          {/* 3. Nom du Chapitre */}
          <h2
            data-testid="fullscreen-chapter-title"
            className="mt-3 font-display text-base font-semibold text-[#dcd6c8] sm:text-lg"
          >
            {chapterTitle}
          </h2>

          {/* Retro tape progress gauge */}
          <div className="mx-auto mt-4 flex max-w-md items-center gap-3">
            <span className="font-mono text-[10px] tracking-wider text-[#9ea3ae]">BANDE</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full border border-[#3a3e47] bg-[#111317] p-[1px]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#d9531e] to-[#e77b3f]"
                style={{ width: `${Math.round(chapterProgressRatio * 100)}%` }}
              />
            </div>
            <span className="font-mono text-xs font-semibold tabular-nums text-[#e6dfd1]">
              {Math.round(chapterProgressRatio * 100)}%
            </span>
          </div>
        </div>

        {/* Error alert if any */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-[#8e3e29] bg-[#2a1915] px-4 py-3 text-center text-xs text-[#f6c4b8]"
          >
            {errorMessage}
          </div>
        )}

        {/* Active passage card (single segment in DOM — archival paper cassette insert look) */}
        <div className="flex flex-1 flex-col justify-center">
          {!hasBook ? (
            <div className="walkman-retro-panel rounded-2xl p-8 text-center text-sm text-[#a6aab3]">
              Quittez le plein écran pour importer un livre ou coller un texte.
            </div>
          ) : isUntranslated ? (
            <div className="walkman-retro-panel rounded-2xl p-6 text-center">
              <p className="text-sm text-[#ddd8ce]">
                Ce chapitre est en anglais et doit être traduit en français avant l’écoute.
              </p>
              <button
                type="button"
                onClick={onTranslateActiveChapter}
                disabled={isTranslating}
                className="mech-key-orange mt-4 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-45"
              >
                <Languages className="h-4 w-4" aria-hidden="true" />
                <span>Traduire ce chapitre en français</span>
              </button>
            </div>
          ) : showExcerpt ? (
            <div
              data-testid="fullscreen-active-segment"
              className="overflow-hidden rounded-2xl border-2 border-[#474b54] bg-[#f4f0e6] text-[#1c1e21] shadow-xl"
            >
              {/* Cassette J-card warm paper header strip */}
              <div className="flex items-center justify-between gap-2 border-b border-[#dad2c3] bg-[#ebe5d8] px-4 py-2 text-[11px]">
                <span className="font-mono font-semibold tabular-nums text-[#4a473f]">
                  FACE A · PASSAGE {activeSegmentIndex + 1}/{Math.max(1, totalSegmentsInChapter)}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onPrevSegment}
                    disabled={activeSegmentIndex <= 0 || isExporting}
                    className="mech-key rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold text-[#1c1e21] disabled:opacity-40"
                  >
                    ‹ Seg. préc.
                  </button>
                  <button
                    type="button"
                    onClick={onNextSegment}
                    disabled={activeSegmentIndex >= totalSegmentsInChapter - 1 || isExporting}
                    className="mech-key rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold text-[#1c1e21] disabled:opacity-40"
                  >
                    Seg. suiv. ›
                  </button>
                </div>
              </div>

              <div className="max-h-[34vh] space-y-3 overflow-y-auto px-5 py-5 text-base leading-[1.78] text-[#1f2125] sm:px-7 sm:py-6 sm:text-[17px]">
                {activeParagraphs.length > 0 ? (
                  activeParagraphs.map((para, index) => <p key={index}>{para}</p>)
                ) : (
                  <p className="text-sm text-[#6a675f]">Prêt pour la lecture.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="walkman-retro-panel rounded-2xl px-6 py-8 text-center font-mono text-xs text-[#a7acb6]">
              FEUILLET TEXTE MASQUÉ · ÉCOUTE CONCENTRÉE
            </div>
          )}
        </div>

        {/* Retro Mechanical Walkman Transport Console */}
        <div className="walkman-retro-panel relative space-y-4 rounded-2xl p-4 sm:p-5">
          {/* LCD Timecode Counter + Recessed Hardware Fader */}
          <div className="space-y-2.5 rounded-xl border border-[#32353e] bg-[#14161a] p-3.5 shadow-inner">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9fa4ae]">
                Compteur de bande
              </span>
              <div className="retro-lcd-window rounded-md px-3 py-1 font-mono text-xs font-semibold tracking-wider tabular-nums text-[#f3d19c]">
                <span>{formatTimecode(segmentCurrentTime)}</span>
                <span className="mx-1.5 text-[#6f7480]">/</span>
                <span className="text-[#a5aab4]">{formatTimecode(effectiveDuration)}</span>
              </div>
            </div>
            <label htmlFor="fullscreen-scrubber" className="sr-only">
              Position dans le segment audio
            </label>
            <input
              id="fullscreen-scrubber"
              type="range"
              min={0}
              max={Math.max(0.1, effectiveDuration)}
              step={0.1}
              value={Math.min(segmentCurrentTime, effectiveDuration || 0)}
              disabled={!hasBook || effectiveDuration <= 0}
              onChange={(e) => onSeekSegment(Number(e.target.value))}
              className="walkman-fader w-full disabled:opacity-40"
            />
          </div>

          {/* 3D Tactile Mechanical Transport Keys */}
          <div className="rounded-xl border border-[#31343d] bg-[#121418] p-2.5 shadow-inner">
            <div
              role="group"
              aria-label="Commandes mécaniques plein écran"
              className="grid grid-cols-3 gap-2.5 sm:grid-cols-6"
            >
              <button
                type="button"
                onClick={onPrevChapter}
                disabled={!hasBook || activeChapterIndex <= 0}
                aria-label="Chapitre précédent"
                className="mech-key-dark flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider disabled:opacity-35"
              >
                <SkipBack className="h-4 w-4" aria-hidden="true" />
                <span>PRÉC.</span>
              </button>

              <button
                type="button"
                onClick={onRewind}
                disabled={!hasBook || isExporting}
                aria-label="Retour rapide"
                className="mech-key-dark flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider disabled:opacity-35"
              >
                <Rewind className="h-4 w-4" aria-hidden="true" />
                <span>REW</span>
              </button>

              {isPlaying || isBuffering ? (
                <button
                  type="button"
                  onClick={onPause}
                  disabled={!hasBook}
                  aria-pressed={true}
                  aria-label="Mettre en pause"
                  className="mech-key-orange mech-key-pressed flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider text-white disabled:opacity-45"
                >
                  <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>PAUSE</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPlay}
                  disabled={!hasBook || isExporting}
                  aria-label="Lire ou reprendre exactement au point d’arrêt"
                  className="mech-key-orange flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider text-white disabled:opacity-45"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>PLAY</span>
                </button>
              )}

              <button
                type="button"
                onClick={onStop}
                disabled={!hasBook}
                aria-label="Arrêter la lecture en conservant la position"
                className="mech-key-dark flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider disabled:opacity-35"
              >
                <Square className="h-3.5 w-3.5 fill-current text-[#e8c68d]" aria-hidden="true" />
                <span>STOP</span>
              </button>

              <button
                type="button"
                onClick={onFastForward}
                disabled={!hasBook || isExporting}
                aria-label="Avance rapide"
                className="mech-key-dark flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider disabled:opacity-35"
              >
                <FastForward className="h-4 w-4" aria-hidden="true" />
                <span>FF</span>
              </button>

              <button
                type="button"
                onClick={onNextChapter}
                disabled={!hasBook || activeChapterIndex >= totalChapters - 1}
                aria-label="Chapitre suivant"
                className="mech-key-dark flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold tracking-wider disabled:opacity-35"
              >
                <SkipForward className="h-4 w-4" aria-hidden="true" />
                <span>SUIV.</span>
              </button>
            </div>
          </div>

          {/* Volume + Mechanical Retro Utility Switches */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="flex min-w-[180px] flex-1 items-center gap-2.5 rounded-lg border border-[#343842] bg-[#16181d] px-3 py-2">
              <button
                type="button"
                onClick={onToggleMute}
                aria-label={muted ? 'Réactiver le son' : 'Couper le son'}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#454954] bg-[#252830] text-[#f4f1ea] hover:bg-[#323640]"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
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
              <span className="w-9 text-right font-mono text-xs tabular-nums text-[#d8d3c8]">
                {Math.round((muted ? 0 : volume) * 100)}%
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onAddBookmark}
                disabled={!hasBook || isUntranslated}
                className={`mech-key-dark inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-40 ${
                  isCurrentSegmentBookmarked
                    ? 'mech-key-pressed !border-[#d9531e] !text-[#f8c1aa]'
                    : ''
                }`}
              >
                {isCurrentSegmentBookmarked ? (
                  <BookmarkCheck className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                ) : (
                  <Bookmark className="h-3.5 w-3.5 text-[#d9b87c]" aria-hidden="true" />
                )}
                <span>Repère</span>
              </button>

              <button
                type="button"
                onClick={() => setShowExcerpt((prev) => !prev)}
                className="mech-key-dark inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
              >
                {showExcerpt ? (
                  <EyeOff className="h-3.5 w-3.5 text-[#d9b87c]" aria-hidden="true" />
                ) : (
                  <Eye className="h-3.5 w-3.5 text-[#d9b87c]" aria-hidden="true" />
                )}
                <span>{showExcerpt ? 'Masquer texte' : 'Afficher texte'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowTuning((prev) => !prev)}
                aria-expanded={showTuning}
                className={`mech-key-dark inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
                  showTuning ? 'mech-key-pressed !border-[#d9531e] !text-[#f8c1aa]' : ''
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                <span className="font-mono">{speed.toFixed(2)}×</span>
              </button>
            </div>
          </div>

          {/* Optional retro tuning tray (mounted only when opened) */}
          {showTuning && (
            <div className="space-y-3 rounded-xl border border-[#353944] bg-[#15171c] p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#d9b87c]">
                  Égaliseur de bande · Vitesse / Ton / Pauses
                </span>
                {isTuningModified && (
                  <button
                    type="button"
                    onClick={onResetTuning}
                    className="inline-flex items-center gap-1 font-semibold text-[#f07645] hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" aria-hidden="true" />
                    <span>Réinitialiser</span>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div>
                  <div className="mb-1 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-speed">Vitesse</label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {speed.toFixed(2)}×
                    </span>
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
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => onSpeedChange(preset)}
                        className={`rounded border px-2 py-0.5 font-mono text-[11px] font-semibold ${
                          Math.abs(speed - preset) < 0.01
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3f4450] bg-[#24272f] text-[#d5d8e0] hover:bg-[#30343f]'
                        }`}
                      >
                        {preset.toFixed(2)}×
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-pitch">Hauteur</label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {formatPitchLabel(pitchSemitones)}
                    </span>
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
                  <div className="mb-1 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-pause">Pause ponctuation</label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {pauseDurationSeconds.toFixed(1)} s
                    </span>
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
