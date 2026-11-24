import {
  AlertCircle,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Disc3,
  Download,
  FastForward,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { getNeuralVoiceById } from '../constants/voices';
import type {
  BookSession,
  ChapterItem,
  ExportProgress,
  NeuralVoiceId,
  ReadyMp3Download,
  TransportState,
} from '../types/walkman';
import { formatPitchLabel, formatTimecode } from '../utils/bookSplitter';
import { formatByteSizeFr } from '../utils/mp3Encoder';
import { ExportProgressCard } from './ExportProgressCard';

interface WalkmanDeckProps {
  session: BookSession | null;
  activeChapter: ChapterItem | null;
  activeChapterIndex: number;
  neuralVoiceId: NeuralVoiceId;
  transportState: TransportState;
  activeSegmentIndex: number;
  totalSegmentsInChapter: number;
  segmentCurrentTime: number;
  segmentDuration: number;
  chapterProgressRatio: number;
  vuLevel: number;
  speed: number;
  pitchSemitones: number;
  volume: number;
  muted: boolean;
  exportProgress: ExportProgress | null;
  exportSuccessMessage: string | null;
  exportErrorMessage: string | null;
  readyMp3: ReadyMp3Download | null;
  hasDraftText: boolean;
  isTranslating: boolean;
  isCurrentSegmentBookmarked: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRewind: () => void;
  onFastForward: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  onSeekSegment: (seconds: number) => void;
  onSpeedChange: (speed: number) => void;
  onPitchChange: (semitones: number) => void;
  onResetTuning: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onAddBookmark: () => void;
  onExportChapterMp3: () => void;
  onExportBookMp3: () => void;
  onCancelExport: () => void;
  onDismissReadyMp3: () => void;
}

const SPEED_PRESETS = [0.75, 1.0, 1.25, 1.5];
const PITCH_PRESETS = [
  { label: '-3 st', value: -3 },
  { label: '0', value: 0 },
  { label: '+3 st', value: 3 },
];

function ReelWheel({
  spinning,
  spinDurationSec,
  tapeRadius,
}: {
  spinning: boolean;
  spinDurationSec: number;
  tapeRadius: number;
}) {
  return (
    <div className="relative flex h-20 w-20 items-center justify-center sm:h-24 sm:w-24">
      <div
        className="absolute rounded-full border border-[#3a3630] bg-[#1d1814] shadow-inner transition-all duration-300"
        style={{
          width: `${tapeRadius}%`,
          height: `${tapeRadius}%`,
        }}
      />
      <svg
        viewBox="0 0 64 64"
        className="reel-spin relative z-10 h-11 w-11 sm:h-12 sm:w-12"
        style={{
          animation: spinning ? `spin ${spinDurationSec}s linear infinite` : 'none',
        }}
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="28" fill="#e8e5dd" stroke="#999488" strokeWidth="2.5" />
        <circle cx="32" cy="32" r="14" fill="#181a1d" stroke="#7c786e" strokeWidth="2" />
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 32 32)`}>
            <rect x="30" y="14" width="4" height="7" rx="1" fill="#e8e5dd" />
            <rect x="29.5" y="4" width="5" height="6" rx="1.2" fill="#25272b" opacity="0.55" />
          </g>
        ))}
        <circle cx="32" cy="32" r="5" fill="#2d3036" />
      </svg>
    </div>
  );
}

export function WalkmanDeck({
  session,
  activeChapter,
  activeChapterIndex,
  neuralVoiceId,
  transportState,
  activeSegmentIndex,
  totalSegmentsInChapter,
  segmentCurrentTime,
  segmentDuration,
  chapterProgressRatio,
  vuLevel,
  speed,
  pitchSemitones,
  volume,
  muted,
  exportProgress,
  exportSuccessMessage,
  exportErrorMessage,
  readyMp3,
  hasDraftText,
  isTranslating,
  isCurrentSegmentBookmarked,
  onPlay,
  onPause,
  onStop,
  onRewind,
  onFastForward,
  onPrevChapter,
  onNextChapter,
  onSeekSegment,
  onSpeedChange,
  onPitchChange,
  onResetTuning,
  onVolumeChange,
  onToggleMute,
  onAddBookmark,
  onExportChapterMp3,
  onExportBookMp3,
  onCancelExport,
  onDismissReadyMp3,
}: WalkmanDeckProps) {
  const isPlaying = transportState === 'playing';
  const isPaused = transportState === 'paused';
  const isBuffering = transportState === 'buffering';
  const isExporting = Boolean(exportProgress);
  const hasBook = Boolean(session && activeChapter);
  const canExport = hasBook || hasDraftText;
  const totalChapters = session?.chapters.length ?? 0;

  const leftTapeRadius = Math.round(92 - chapterProgressRatio * 30);
  const rightTapeRadius = Math.round(62 + chapterProgressRatio * 30);

  const spinDurationSec = isBuffering || isTranslating
    ? 3.0
    : Math.max(0.75, Math.min(3.5, 1.9 / Math.max(0.5, speed)));

  const neuralVoiceProfile = getNeuralVoiceById(neuralVoiceId);
  const vuNeedleAngle = -42 + Math.min(1, isBuffering ? 0.35 : vuLevel) * 84;

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
              ? 'Prêt'
              : 'Aucune bande';

  const cassetteChapterLabel =
    activeChapter?.translationStatus === 'needs_translation'
      ? `Chapitre ${activeChapterIndex + 1} (à traduire)`
      : activeChapter?.title ?? '';

  const isTuningModified = Math.abs(speed - 1.0) > 0.01 || Math.abs(pitchSemitones) > 0.05;
  const totalBookSegments = session
    ? session.chapters.reduce((sum, ch) => sum + ch.segments.length, 0)
    : 0;

  return (
    <section
      id="lecteur"
      aria-label="Baladeur Walkman Sonobande"
      data-testid="walkman-deck"
      data-transport-state={transportState}
      className="walkman-aluminum relative rounded-2xl border border-[#aba69b] p-5 sm:p-6"
    >
      {/* Top Mechanical Vintage Transport Buttons */}
      <div className="mb-5 rounded-xl bg-[#25272b] p-2.5 shadow-inner">
        <div
          role="group"
          aria-label="Commandes mécaniques du baladeur"
          className="grid grid-cols-3 gap-2 sm:grid-cols-6"
        >
          {/* PLAY (Walkman Orange Primary Key) */}
          <button
            type="button"
            onClick={onPlay}
            disabled={!hasBook || isExporting}
            aria-pressed={isPlaying}
            aria-label="Lire le chapitre actif"
            className={`mech-key-orange flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-45 ${
              isPlaying || isBuffering ? 'mech-key-pressed' : ''
            }`}
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span className="whitespace-nowrap">PLAY</span>
          </button>

          {/* PAUSE */}
          <button
            type="button"
            onClick={onPause}
            disabled={!hasBook || (!isPlaying && !isBuffering)}
            aria-pressed={isPaused}
            aria-label="Mettre la lecture en pause"
            className={`mech-key flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 ${
              isPaused ? 'mech-key-pressed !border-[#d9531e] !text-[#b93e0e]' : ''
            }`}
          >
            <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
            <span className="whitespace-nowrap">PAUSE</span>
          </button>

          {/* STOP */}
          <button
            type="button"
            onClick={onStop}
            disabled={!hasBook}
            aria-label="Arrêter et revenir au début du chapitre"
            className="mech-key flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
          >
            <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            <span className="whitespace-nowrap">STOP</span>
          </button>

          {/* REW */}
          <button
            type="button"
            onClick={onRewind}
            disabled={!hasBook || isExporting}
            aria-label="Retour rapide"
            className="mech-key flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
          >
            <Rewind className="h-4 w-4" aria-hidden="true" />
            <span className="whitespace-nowrap">REW</span>
          </button>

          {/* FF */}
          <button
            type="button"
            onClick={onFastForward}
            disabled={!hasBook || isExporting}
            aria-label="Avance rapide"
            className="mech-key flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
          >
            <FastForward className="h-4 w-4" aria-hidden="true" />
            <span className="whitespace-nowrap">FF</span>
          </button>

          {/* NEXT CHAPTER */}
          <button
            type="button"
            onClick={onNextChapter}
            disabled={!hasBook || activeChapterIndex >= totalChapters - 1}
            aria-label="Chapitre suivant"
            className="mech-key flex min-h-[54px] flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
            <span className="whitespace-nowrap">SUIV.</span>
          </button>
        </div>
      </div>

      {/* Hardware Silkscreen Header Strip */}
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-sm font-bold tracking-[0.14em] text-[#22252a]">
            SONOBANDE
          </span>
          <span className="text-xs font-medium text-[#55585e]">
            {'Voix neuronale illimitée'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-[#3b3e44]">
          {(isPlaying || isBuffering || isExporting) && (
            <span
              className="inline-block h-2 w-2 rounded-full bg-[#d9531e]"
              aria-hidden="true"
            />
          )}
          <span data-testid="walkman-status" className="font-mono">
            {statusText}
          </span>
        </div>
      </div>

      {/* Smoked Acrylic Cassette Bay */}
      <div className="walkman-graphite relative overflow-hidden rounded-xl border-2 border-[#393c42] px-4 pt-5 pb-7 sm:px-5">
        <span
          aria-hidden="true"
          className="absolute top-2.5 left-2.5 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
        />
        <span
          aria-hidden="true"
          className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
        />
        <span
          aria-hidden="true"
          className="absolute bottom-2.5 left-2.5 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
        />
        <span
          aria-hidden="true"
          className="absolute right-2.5 bottom-2.5 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
        />

        {/* Cassette Shell Window */}
        <div className="rounded-lg border border-[#3e4249] bg-[#16181b] p-3.5 sm:p-4">
          <div className="mb-3.5 overflow-hidden rounded-md border border-[#383a3e] bg-[#f4f1ea] text-[#1c1e21]">
            <div
              className="flex items-center justify-between px-3 py-1.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: '#D9531E' }}
            >
              <span className="font-mono">
                {session
                  ? `Chapitre ${activeChapterIndex + 1} / ${totalChapters}`
                  : 'C-90 Locale'}
              </span>
              <span className="font-mono">
                {session ? `Seg. ${activeSegmentIndex + 1}/${Math.max(1, totalSegmentsInChapter)}` : 'Texte'}
              </span>
            </div>

            <div className="px-3 py-2.5">
              {session && activeChapter ? (
                <>
                  <p
                    data-testid="active-cassette-title"
                    className="truncate font-display text-sm font-semibold text-[#1c1e21] sm:text-base"
                  >
                    {cassetteChapterLabel}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-[#55585e]">
                    <span className="truncate max-w-[160px]">{session.title}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {`${neuralVoiceProfile.name} (${neuralVoiceProfile.timbre})`}
                    </span>
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 py-1 text-xs text-[#55585e]">
                  <Disc3 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Importez un livre PDF/EPUB ou collez un texte à droite pour commencer.</span>
                </div>
              )}
            </div>
          </div>

          {/* Transparent Smoked Reel Window */}
          <div className="relative flex items-center justify-between rounded-md border border-[#2d3036] bg-[#0e1012] px-4 py-3 sm:px-7">
            <ReelWheel
              spinning={isPlaying || isBuffering}
              spinDurationSec={spinDurationSec}
              tapeRadius={leftTapeRadius}
            />

            <div className="mx-2 flex flex-1 flex-col items-center justify-center">
              <div className="h-1.5 w-full max-w-[110px] overflow-hidden rounded-full bg-[#24272c]">
                <div
                  className="h-full transition-all duration-150"
                  style={{
                    width: `${Math.round(chapterProgressRatio * 100)}%`,
                    backgroundColor: '#D9531E',
                  }}
                />
              </div>
              <span className="mt-2 font-mono text-[11px] tabular-nums text-[#9fa3ab]">
                {Math.round(chapterProgressRatio * 100)} %
              </span>
              {totalChapters > 1 && (
                <div className="mt-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={onPrevChapter}
                    disabled={activeChapterIndex <= 0}
                    aria-label="Chapitre précédent"
                    className="flex h-6 w-6 items-center justify-center rounded border border-[#35383f] bg-[#1a1c20] text-[#c9ccd1] hover:bg-[#25282e] disabled:opacity-35"
                  >
                    <SkipBack className="h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={onNextChapter}
                    disabled={activeChapterIndex >= totalChapters - 1}
                    aria-label="Chapitre suivant"
                    className="flex h-6 w-6 items-center justify-center rounded border border-[#35383f] bg-[#1a1c20] text-[#c9ccd1] hover:bg-[#25282e] disabled:opacity-35"
                  >
                    <SkipForward className="h-3 w-3" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            <ReelWheel
              spinning={isPlaying || isBuffering}
              spinDurationSec={spinDurationSec}
              tapeRadius={rightTapeRadius}
            />
          </div>
        </div>

        {/* Analog VU Meter & Mechanical Tape Counter */}
        <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border border-[#3a3d43] bg-[#efe9da] px-3 py-2 text-[#1e2024]">
            <span className="font-mono text-[11px] font-semibold text-[#4b473e]">VU</span>
            <div className="relative h-9 w-36 overflow-hidden">
              <svg viewBox="0 0 140 50" className="h-full w-full" aria-hidden="true">
                <path
                  d="M 16 44 A 56 56 0 0 1 124 44"
                  fill="none"
                  stroke="#36342e"
                  strokeWidth="1.5"
                />
                <path
                  d="M 96 15 A 56 56 0 0 1 124 44"
                  fill="none"
                  stroke="#d9531e"
                  strokeWidth="3"
                />
                {[-38, -22, -6, 10, 26, 38].map((angle) => (
                  <line
                    key={angle}
                    x1="70"
                    y1="48"
                    x2="70"
                    y2="6"
                    stroke={angle > 15 ? '#d9531e' : '#57534a'}
                    strokeWidth="1"
                    strokeDasharray="0 36 5 10"
                    transform={`rotate(${angle} 70 48)`}
                  />
                ))}
                <line
                  x1="70"
                  y1="48"
                  x2="70"
                  y2="8"
                  stroke="#1c1e21"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  style={{
                    transformOrigin: '70px 48px',
                    transform: `rotate(${vuNeedleAngle}deg)`,
                    transition: 'transform 80ms ease-out',
                  }}
                />
                <circle cx="70" cy="48" r="4" fill="#1c1e21" />
              </svg>
            </div>
            <span className="font-mono text-[11px] text-[#d9531e]">+3</span>
          </div>

          <div className="flex flex-col justify-center rounded-lg border border-[#3a3d43] bg-[#111316] px-3.5 py-2">
            <span className="text-[10px] font-medium tracking-wide text-[#9fa3ab]">
              Segment en cours
            </span>
            <div
              data-testid="walkman-counter"
              className="mt-0.5 font-mono text-sm font-medium tracking-wider tabular-nums text-[#f3efe6] whitespace-nowrap"
            >
              <span>{formatTimecode(segmentCurrentTime)}</span>
              <span className="mx-1.5 text-[#6e727a]">/</span>
              <span className="text-[#a5a9b1]">{formatTimecode(segmentDuration)}</span>
            </div>
          </div>
        </div>

        {/* Segment Position Scrubber */}
        <div className="mt-3.5 flex items-center gap-3 px-1">
          <label htmlFor="tape-scrubber" className="sr-only">
            Position dans le segment audio
          </label>
          <input
            id="tape-scrubber"
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
      </div>

      {/* Tactile Tuning Controls (Vitesse & Hauteur) */}
      <div className="mt-5 space-y-4 rounded-xl border border-[#b6b1a6] bg-[#dedbd3] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-[#1c1e21]">
            Réglages d&apos;écoute
          </h2>
          {isTuningModified && (
            <button
              type="button"
              onClick={onResetTuning}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#b93e0e] transition-colors hover:text-[#8f2e08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Réinitialiser</span>
            </button>
          )}
        </div>

        {/* Speed */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="speed-slider" className="text-xs font-semibold text-[#2e3136]">
              Vitesse de lecture
            </label>
            <span
              data-testid="speed-value"
              className="font-mono text-xs font-semibold tabular-nums text-[#1c1e21]"
            >
              {speed.toFixed(2)}×
            </span>
          </div>
          <input
            id="speed-slider"
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={speed}
            onChange={(e) => onSpeedChange(Number(e.target.value))}
            className="walkman-fader w-full"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {SPEED_PRESETS.map((preset) => {
              const active = Math.abs(speed - preset) < 0.01;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onSpeedChange(preset)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-xs font-medium tabular-nums whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d9531e] ${
                    active
                      ? 'border-[#1c1e21] bg-[#1c1e21] text-[#f7f5f0]'
                      : 'border-[#b3aea3] bg-[#ece9e2] text-[#35383d] hover:bg-[#f7f5f0]'
                  }`}
                >
                  {preset.toFixed(2)}×
                </button>
              );
            })}
          </div>
        </div>

        <hr className="border-[#c6c1b6]" />

        {/* Pitch */}
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor="pitch-slider" className="text-xs font-semibold text-[#2e3136]">
              Hauteur de ton
            </label>
            <span
              data-testid="pitch-value"
              className="font-mono text-xs font-semibold tabular-nums text-[#1c1e21]"
            >
              {formatPitchLabel(pitchSemitones)}
            </span>
          </div>
          <input
            id="pitch-slider"
            type="range"
            min={-6}
            max={6}
            step={0.5}
            value={pitchSemitones}
            onChange={(e) => onPitchChange(Number(e.target.value))}
            className="walkman-fader w-full"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#55585e]">Plus grave</span>
            <div className="flex items-center gap-1.5">
              {PITCH_PRESETS.map((preset) => {
                const active = Math.abs(pitchSemitones - preset.value) < 0.05;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => onPitchChange(preset.value)}
                    className={`rounded-md border px-2.5 py-1 font-mono text-xs font-medium tabular-nums whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d9531e] ${
                      active
                        ? 'border-[#1c1e21] bg-[#1c1e21] text-[#f7f5f0]'
                        : 'border-[#b3aea3] bg-[#ece9e2] text-[#35383d] hover:bg-[#f7f5f0]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
            <span className="text-[11px] text-[#55585e]">Plus aigu</span>
          </div>
        </div>
      </div>

      {/* Volume + Flexible MP3 Export (Chapter or Full Book) */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-[#b6b1a6] bg-[#d6d2ca] px-3 py-2">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Réactiver le son' : 'Couper le son'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#25272b] transition-colors hover:bg-[#c8c4bb] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
          >
            {muted || volume === 0 ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
          <label htmlFor="volume-slider" className="sr-only">
            Volume de sortie
          </label>
          <input
            id="volume-slider"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="walkman-fader w-full"
          />
          <span className="w-9 text-right font-mono text-xs tabular-nums text-[#34373c]">
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
          <span className="mx-0.5 h-5 w-px bg-[#b6b1a6]" aria-hidden="true" />
          <button
            type="button"
            onClick={onAddBookmark}
            disabled={!hasBook || activeChapter?.translationStatus === 'needs_translation'}
            aria-label="Poser un marque-page sur le passage actif"
            title="Poser un marque-page sur le passage actif"
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-40 ${
              isCurrentSegmentBookmarked
                ? 'bg-[#efe1d1] text-[#8f2e08]'
                : 'text-[#25272b] hover:bg-[#c8c4bb]'
            }`}
          >
            {isCurrentSegmentBookmarked ? (
              <BookmarkCheck className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
            ) : (
              <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Repère</span>
          </button>
        </div>

        {/* MP3 Export Step-by-Step Progress or Dual Export Buttons */}
        {exportProgress ? (
          <ExportProgressCard progress={exportProgress} onCancel={onCancelExport} />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={onExportChapterMp3}
              disabled={!canExport}
              className="mech-key inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download className="h-4 w-4 text-[#d9531e] shrink-0" aria-hidden="true" />
              <span>MP3 du chapitre</span>
            </button>

            <button
              type="button"
              onClick={onExportBookMp3}
              disabled={!canExport}
              className="mech-key inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download className="h-4 w-4 text-[#1c1e21] shrink-0" aria-hidden="true" />
              <span>
                {totalChapters > 1
                  ? `MP3 livre entier (${totalBookSegments} seg.)`
                  : 'MP3 complet'}
              </span>
            </button>
          </div>
        )}

        {exportErrorMessage && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#d49a89] bg-[#fbefeb] px-3 py-2 text-xs text-[#8a280b]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{exportErrorMessage}</span>
          </div>
        )}

        {readyMp3 && !exportProgress && (
          <div
            data-testid="ready-mp3-card"
            role="status"
            className="rounded-lg border border-[#b9cbbd] bg-[#eef5ef] p-3 text-[#1d3f27]"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2c5e3b]" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[#1c1e21]">
                    {readyMp3.filename}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#3c5944]">
                    MP3 prêt en mémoire ({formatByteSizeFr(readyMp3.sizeBytes)})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onDismissReadyMp3}
                aria-label="Fermer le lien MP3"
                className="rounded p-0.5 text-[#4a6352] hover:bg-[#dfece2] hover:text-[#1c1e21]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <a
                href={readyMp3.url}
                download={readyMp3.filename}
                data-testid="direct-mp3-download-link"
                className="inline-flex items-center gap-1.5 rounded-md bg-[#1c1e21] px-3 py-1.5 text-xs font-semibold text-[#f7f5f0] whitespace-nowrap transition-colors hover:bg-[#31343a] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
              >
                <Download className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                <span>Télécharger le MP3</span>
              </a>
              <span className="text-[11px] text-[#45614d]">
                Cliquez ici si votre navigateur bloque le téléchargement automatique
              </span>
            </div>
          </div>
        )}

        {exportSuccessMessage && !readyMp3 && (
          <p role="status" className="text-right text-xs font-medium text-[#2c5e3b]">
            {exportSuccessMessage}
          </p>
        )}
      </div>
    </section>
  );
}
