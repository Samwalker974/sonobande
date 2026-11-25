import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  ChevronDown,
  Disc3,
  Download,
  Eye,
  EyeOff,
  FastForward,
  FileText,
  FolderOpen,
  Languages,
  ListMusic,
  Loader2,
  Minimize2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { NEURAL_FRENCH_VOICES } from '../constants/voices';
import type {
  BookSession,
  ChapterItem,
  NeuralVoiceId,
  TransportState,
  VoiceRuntimeStatus,
} from '../types/walkman';
import { DEFAULT_PAUSE_DURATION_SECONDS } from '../utils/audioDsp';
import { formatPitchLabel, formatTimecode } from '../utils/bookSplitter';
import {
  buildBookToc,
  formatTocCompactBadge,
  formatTocCompositionSummary,
  formatTocLocationLabel,
} from '../utils/bookToc';
import { stripParasiticCharacters } from '../utils/speechSanitizer';

interface FullscreenListeningViewProps {
  session: BookSession | null;
  activeChapter: ChapterItem | null;
  activeChapterIndex: number;
  neuralVoiceId: NeuralVoiceId;
  voiceStatuses: Record<NeuralVoiceId, VoiceRuntimeStatus>;
  transportState: TransportState;
  activeSegmentIndex: number;
  totalSegmentsInChapter: number;
  segmentCurrentTime: number;
  segmentDuration: number;
  chapterProgressRatio: number;
  speed: number;
  pitchSemitones: number;
  pauseDurationSeconds: number;
  hdVoiceEnhanced: boolean;
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
  onSelectChapter: (chapterIndex: number) => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onSeekSegment: (seconds: number) => void;
  onSpeedChange: (speed: number) => void;
  onPitchChange: (semitones: number) => void;
  onPauseDurationChange: (seconds: number) => void;
  onToggleHdVoice: () => void;
  onSelectOrDownloadVoice: (voiceId: NeuralVoiceId) => void;
  onResetTuning: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onAddBookmark: () => void;
  onTranslateActiveChapter: () => void;
}

const SPEED_PRESETS = [
  { label: 'Lent', value: 0.85 },
  { label: 'Normal', value: 1.0 },
  { label: 'Dynamique', value: 1.2 },
  { label: 'Rapide', value: 1.45 },
];
const PITCH_PRESETS = [
  { label: 'Plus grave', value: -2.5 },
  { label: 'Naturel', value: 0 },
  { label: 'Plus aigu', value: 2.5 },
];
const PAUSE_PRESETS = [
  { label: 'Rapide (0 s)', value: 0 },
  { label: 'Naturelle (0.3 s)', value: 0.3 },
  { label: 'Posée (0.7 s)', value: 0.7 },
];

function describePitchShort(semitones: number): string {
  if (semitones <= -0.5) return 'Grave';
  if (semitones >= 0.5) return 'Aigu';
  return 'Naturel';
}

export function FullscreenListeningView({
  session,
  activeChapter,
  activeChapterIndex,
  neuralVoiceId,
  voiceStatuses,
  transportState,
  activeSegmentIndex,
  totalSegmentsInChapter,
  segmentCurrentTime,
  segmentDuration,
  chapterProgressRatio,
  speed,
  pitchSemitones,
  pauseDurationSeconds,
  hdVoiceEnhanced,
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
  onSelectChapter,
  onPrevSegment,
  onNextSegment,
  onSeekSegment,
  onSpeedChange,
  onPitchChange,
  onPauseDurationChange,
  onToggleHdVoice,
  onSelectOrDownloadVoice,
  onResetTuning,
  onVolumeChange,
  onToggleMute,
  onAddBookmark,
  onTranslateActiveChapter,
}: FullscreenListeningViewProps) {
  const [showExcerpt, setShowExcerpt] = useState(true);
  const [showTuning, setShowTuning] = useState(false);
  const [showChapters, setShowChapters] = useState(false);

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

  const toc = useMemo(
    () => (session ? buildBookToc(session.chapters, session.title) : null),
    [session]
  );
  const activeTocEntry = toc?.entries[activeChapterIndex] ?? null;

  const chapterTitle = isUntranslated
    ? `${activeTocEntry?.displayTitle ?? `Section ${activeChapterIndex + 1}`} (anglais — à traduire)`
    : activeTocEntry?.displayTitle ?? activeChapter?.title ?? 'Aucune section active';

  const locationSummary = toc
    ? formatTocLocationLabel(toc, activeChapterIndex)
    : `Chapitre ${activeChapterIndex + 1} / ${totalChapters}`;

  const compactLocationBadge = toc
    ? formatTocCompactBadge(toc, activeChapterIndex)
    : `${activeChapterIndex + 1}/${totalChapters}`;

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

          {/* 2. Chapitre X / Y · Segment A / B · Pause / Lecture (cliquable pour choisir un chapitre) */}
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              disabled={!hasBook || totalChapters <= 1}
              onClick={() => {
                setShowChapters((prev) => !prev);
                setShowTuning(false);
              }}
              data-testid="fullscreen-chapter-status"
              aria-expanded={showChapters}
              title={totalChapters > 1 ? 'Cliquer pour choisir un chapitre' : undefined}
              className="retro-lcd-window inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg px-3.5 py-1.5 font-mono text-xs font-medium tabular-nums text-[#e8c68d] transition-colors hover:border-[#d9531e]/70 disabled:cursor-default"
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
                  ? `${locationSummary} · Segment ${activeSegmentIndex + 1} / ${Math.max(1, totalSegmentsInChapter)} · ${statusText}`
                  : 'Aucun document chargé'}
              </span>
              {totalChapters > 1 && (
                <ChevronDown
                  className={`h-3.5 w-3.5 text-[#f07645] transition-transform ${
                    showChapters ? 'rotate-180' : ''
                  }`}
                  aria-hidden="true"
                />
              )}
            </button>
          </div>

          {/* 3. Nom de la Partie (si imbriqué) + Nom du Chapitre / Section */}
          {activeTocEntry?.parentPartTitle && (
            <p className="mt-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#d9b87c]">
              {activeTocEntry.parentPartTitle}
            </p>
          )}
          <h2
            data-testid="fullscreen-chapter-title"
            className={`${activeTocEntry?.parentPartTitle ? 'mt-1' : 'mt-3'} font-display text-base font-semibold text-[#dcd6c8] sm:text-lg`}
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
                {segmentDuration <= 0 && segmentCurrentTime > 0 ? (
                  <>
                    <span>{formatTimecode(segmentCurrentTime)}</span>
                    <span className="ml-1.5 text-[10px] uppercase tracking-widest text-[#a5aab4]">
                      Reprise
                    </span>
                  </>
                ) : (
                  <>
                    <span>{formatTimecode(segmentCurrentTime)}</span>
                    <span className="mx-1.5 text-[#6f7480]">/</span>
                    <span className="text-[#a5aab4]">{formatTimecode(effectiveDuration)}</span>
                  </>
                )}
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
              {session && totalChapters > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowChapters((prev) => !prev);
                    setShowTuning(false);
                  }}
                  aria-expanded={showChapters}
                  data-testid="fullscreen-chapters-btn"
                  className={`mech-key-dark inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
                    showChapters ? 'mech-key-pressed !border-[#d9531e] !text-[#f8c1aa]' : ''
                  }`}
                >
                  <ListMusic className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                  <span>Sommaire ({compactLocationBadge})</span>
                </button>
              )}

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
                onClick={() => {
                  setShowTuning((prev) => !prev);
                  setShowChapters(false);
                }}
                aria-expanded={showTuning}
                className={`mech-key-dark inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${
                  showTuning ? 'mech-key-pressed !border-[#d9531e] !text-[#f8c1aa]' : ''
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                <span>Options voix</span>
              </button>
            </div>
          </div>

          {/* Fullscreen Structured Sommaire Drawer (Infos / Parties / Chapitres / Annexes) */}
          {showChapters && session && toc && totalChapters > 1 && (
            <div
              data-testid="fullscreen-chapter-picker"
              className="space-y-2.5 rounded-xl border border-[#353944] bg-[#15171c] p-3.5 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#d9b87c]">
                    Sommaire du livre
                  </span>
                  <span className="ml-2 font-mono text-[10px] text-[#9fa4ae]">
                    {formatTocCompositionSummary(toc)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChapters(false)}
                  aria-label="Fermer le sommaire"
                  className="rounded p-1 text-[#9fa4ae] hover:bg-[#24272f] hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
              <div className="max-h-[36vh] space-y-1.5 overflow-y-auto pr-1">
                {toc.entries.map((entry) => {
                  const idx = entry.chapterIndex;
                  const isActive = idx === activeChapterIndex;
                  const needsTrans = entry.chapter.translationStatus === 'needs_translation';
                  const isPart = entry.kind === 'part';
                  const isFrontmatter = entry.kind === 'frontmatter';
                  const isBackmatter = entry.kind === 'backmatter';
                  const isNested = entry.depth === 1;

                  return (
                    <div
                      key={entry.chapter.id}
                      className={
                        isNested
                          ? `ml-3 border-l-2 pl-2.5 ${
                              isActive ? 'border-[#d9531e]' : 'border-[#333844]'
                            }`
                          : isPart
                            ? 'pt-2 first:pt-0'
                            : ''
                      }
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSelectChapter(idx);
                          setShowChapters(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                          isActive
                            ? 'border-[#d9531e] bg-[#2a1f1b] text-[#f7f4ec]'
                            : isPart
                              ? 'border-[#524530] bg-[#221e18] text-[#f2dba9] hover:border-[#786342] hover:bg-[#2a241c]'
                              : isFrontmatter || isBackmatter
                                ? 'border-[#2a2e38] bg-[#181b21] text-[#b7bcc7] hover:border-[#434857] hover:bg-[#20242d]'
                                : 'border-[#2f333d] bg-[#1c1f26] text-[#dcd6c8] hover:border-[#4b5160] hover:bg-[#242832]'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          {isPart ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[#3b3021] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[#f3d19c]">
                              <FolderOpen className="h-2.5 w-2.5 text-[#f07645]" aria-hidden="true" />
                              <span>{entry.badgeLabel}</span>
                            </span>
                          ) : isFrontmatter ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded border border-[#3a3f4c] bg-[#22252e] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9fa4ae]">
                              <FileText className="h-2.5 w-2.5" aria-hidden="true" />
                              <span>Infos</span>
                            </span>
                          ) : isBackmatter ? (
                            <span className="inline-flex shrink-0 items-center rounded border border-[#3a3f4c] bg-[#22252e] px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase text-[#9fa4ae]">
                              Fin
                            </span>
                          ) : (
                            <span
                              className={`font-mono text-[11px] font-bold tabular-nums ${
                                isActive ? 'text-[#f07645]' : 'text-[#8c919c]'
                              }`}
                            >
                              {String(entry.chapterNumber ?? idx + 1).padStart(2, '0')}
                            </span>
                          )}
                          <span
                            className={`truncate ${
                              isPart ? 'font-display text-xs font-bold' : 'font-medium'
                            }`}
                          >
                            {entry.displayTitle}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {needsTrans && (
                            <span className="rounded border border-[#5a4a33] bg-[#292218] px-1.5 py-0.5 font-mono text-[9px] text-[#e3c38a]">
                              EN → FR
                            </span>
                          )}
                          {isActive && (
                            <span className="rounded bg-[#d9531e] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-white">
                              Actif
                            </span>
                          )}
                        </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Optional retro voice options tray (mounted only when opened) */}
          {showTuning && (
            <div className="space-y-3.5 rounded-xl border border-[#353944] bg-[#15171c] p-3.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-[#d9b87c]">
                  Options de la voix · Mémorisées automatiquement
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

              <div className="space-y-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#9fa4ae]">
                  Voix française (1 clic pour activer ou télécharger)
                </span>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {NEURAL_FRENCH_VOICES.map((voice) => {
                    const status = voiceStatuses[voice.id];
                    const isSelected = voice.id === neuralVoiceId;
                    const isInstalled = status?.installState === 'installed';
                    const isDownloading = status?.installState === 'downloading';
                    const isFailed =
                      status?.healthState === 'failed' || status?.installState === 'error';
                    const isUnsupported = status?.installState === 'unsupported';

                    return (
                      <button
                        key={voice.id}
                        type="button"
                        disabled={isDownloading || isUnsupported}
                        onClick={() => onSelectOrDownloadVoice(voice.id)}
                        aria-pressed={isSelected}
                        className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-55 ${
                          isSelected
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3f4450] bg-[#24272f] text-[#e6e2da] hover:bg-[#30343f]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-1">
                          <span className="truncate font-bold">{voice.name}</span>
                          {isDownloading ? (
                            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
                          ) : isFailed ? (
                            <AlertCircle className="h-3 w-3 shrink-0 text-[#f6a58e]" aria-hidden="true" />
                          ) : isInstalled ? (
                            <CheckCircle2
                              className={`h-3 w-3 shrink-0 ${isSelected ? 'text-white' : 'text-[#7ad096]'}`}
                              aria-hidden="true"
                            />
                          ) : (
                            <Download className="h-3 w-3 shrink-0 text-[#f07645]" aria-hidden="true" />
                          )}
                        </div>
                        <span
                          className={`truncate text-[10px] ${
                            isSelected ? 'text-white/85' : 'text-[#a3a8b3]'
                          }`}
                        >
                          {isDownloading
                            ? `Téléch. ${status.downloadPercent}%`
                            : isInstalled
                              ? `${voice.gender} · ${voice.timbre}`
                              : `Télécharger (~${voice.approxSizeMb} Mo)`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-[#2c303a] pt-3 sm:grid-cols-3">
                <div>
                  <div className="mb-1.5 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-speed" className="font-semibold">
                      Vitesse
                    </label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {speed.toFixed(2)}×
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-2 gap-1">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onSpeedChange(preset.value)}
                        className={`rounded border px-2 py-1 text-[11px] font-semibold ${
                          Math.abs(speed - preset.value) < 0.03
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3f4450] bg-[#24272f] text-[#d5d8e0] hover:bg-[#30343f]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
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
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-pitch" className="font-semibold">
                      Timbre
                    </label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {describePitchShort(pitchSemitones)} ({formatPitchLabel(pitchSemitones)})
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-3 gap-1">
                    {PITCH_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onPitchChange(preset.value)}
                        className={`rounded border px-1.5 py-1 text-[10px] font-semibold ${
                          Math.abs(pitchSemitones - preset.value) < 0.3
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3f4450] bg-[#24272f] text-[#d5d8e0] hover:bg-[#30343f]'
                        }`}
                      >
                        {preset.label.replace('Plus ', '')}
                      </button>
                    ))}
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
                  <div className="mb-1.5 flex justify-between text-[#d4d0c5]">
                    <label htmlFor="fs-pause" className="font-semibold">
                      Respiration
                    </label>
                    <span className="font-mono font-semibold tabular-nums text-[#f3d19c]">
                      {pauseDurationSeconds === 0 ? 'Aucune' : `${pauseDurationSeconds.toFixed(1)} s`}
                    </span>
                  </div>
                  <div className="mb-2 grid grid-cols-3 gap-1">
                    {PAUSE_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => onPauseDurationChange(preset.value)}
                        className={`rounded border px-1.5 py-1 text-[10px] font-semibold ${
                          Math.abs(pauseDurationSeconds - preset.value) < 0.05
                            ? 'border-[#d9531e] bg-[#d9531e] text-white'
                            : 'border-[#3f4450] bg-[#24272f] text-[#d5d8e0] hover:bg-[#30343f]'
                        }`}
                      >
                        {preset.label.split(' ')[0]}
                      </button>
                    ))}
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

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#2c303a] pt-3">
                <div className="flex items-center gap-2 text-[#e6e2da]">
                  <Sparkles className="h-3.5 w-3.5 text-[#f07645]" aria-hidden="true" />
                  <span className="font-semibold">Voix HD &amp; fluide</span>
                  <span className="hidden text-[#9fa4ae] sm:inline">
                    · Voix plus nette, douce et régulière
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={hdVoiceEnhanced}
                  onClick={onToggleHdVoice}
                  className={`rounded-lg border px-3 py-1 font-mono text-[11px] font-semibold transition-colors ${
                    hdVoiceEnhanced
                      ? 'border-[#d9531e] bg-[#d9531e] text-white'
                      : 'border-[#3f4450] bg-[#24272f] text-[#d5d8e0] hover:bg-[#30343f]'
                  }`}
                >
                  {hdVoiceEnhanced ? 'HD ACTIVÉ' : 'HD DÉSACTIVÉ'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
