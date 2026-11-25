import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Disc3,
  Download,
  FastForward,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Rewind,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getNeuralVoiceById, NEURAL_FRENCH_VOICES } from '../constants/voices';
import type {
  BookSession,
  ChapterItem,
  NeuralVoiceId,
  ReadyMp3Download,
  TransportState,
  VoiceRuntimeStatus,
} from '../types/walkman';
import { DEFAULT_PAUSE_DURATION_SECONDS } from '../utils/audioDsp';
import { formatPitchLabel, formatTimecode } from '../utils/bookSplitter';
import { buildBookToc, formatTocCompactBadge } from '../utils/bookToc';
import { formatByteSizeFr } from '../utils/mp3Encoder';
import { readTuningPanelOpen, writeTuningPanelOpen } from '../utils/voiceStorage';

interface WalkmanDeckProps {
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
  vuLevel: number;
  speed: number;
  pitchSemitones: number;
  pauseDurationSeconds: number;
  hdVoiceEnhanced: boolean;
  volume: number;
  muted: boolean;
  isExporting: boolean;
  playbackErrorMessage?: string | null;
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
  onPauseDurationChange: (seconds: number) => void;
  onToggleHdVoice: () => void;
  onSelectOrDownloadVoice: (voiceId: NeuralVoiceId) => void;
  onTestVoice: (voiceId: NeuralVoiceId) => void;
  onDeleteVoice: (voiceId: NeuralVoiceId) => void;
  onResetTuning: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onAddBookmark: () => void;
  onEnterFullscreen: () => void;
  onExportChapterMp3: () => void;
  onExportBookMp3: () => void;
  onDismissReadyMp3: () => void;
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
    <div className="relative flex h-16 w-16 items-center justify-center sm:h-20 sm:w-20">
      <div
        className="absolute rounded-full border border-[#3a3630] bg-[#1d1814] shadow-inner transition-all duration-300"
        style={{
          width: `${tapeRadius}%`,
          height: `${tapeRadius}%`,
        }}
      />
      <svg
        viewBox="0 0 64 64"
        className="reel-spin relative z-10 h-9 w-9 sm:h-11 sm:w-11"
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
  voiceStatuses,
  transportState,
  activeSegmentIndex,
  totalSegmentsInChapter,
  segmentCurrentTime,
  segmentDuration,
  chapterProgressRatio,
  vuLevel,
  speed,
  pitchSemitones,
  pauseDurationSeconds,
  hdVoiceEnhanced,
  volume,
  muted,
  isExporting,
  playbackErrorMessage,
  exportSuccessMessage,
  exportErrorMessage,
  readyMp3,
  hasDraftText,
  isTranslating,
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
  onPauseDurationChange,
  onToggleHdVoice,
  onSelectOrDownloadVoice,
  onTestVoice,
  onDeleteVoice,
  onResetTuning,
  onVolumeChange,
  onToggleMute,
  onEnterFullscreen,
  onExportChapterMp3,
  onExportBookMp3,
  onDismissReadyMp3,
}: WalkmanDeckProps) {
  const [showTuning, setShowTuning] = useState<boolean>(() => readTuningPanelOpen());
  const toggleShowTuning = () => {
    setShowTuning((prev) => {
      const next = !prev;
      writeTuningPanelOpen(next);
      return next;
    });
  };
  const isPlaying = transportState === 'playing';
  const isPaused = transportState === 'paused';
  const isBuffering = transportState === 'buffering';
  const hasBook = Boolean(session && activeChapter);
  const canExport = hasBook || hasDraftText;
  const totalChapters = session?.chapters.length ?? 0;
  const effectiveDuration = Math.max(segmentDuration, segmentCurrentTime);

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
      ? 'Traduction en cours…'
      : isBuffering
        ? 'Préparation…'
        : isPlaying
          ? 'Lecture'
          : isPaused
            ? 'Pause'
            : hasBook
              ? segmentCurrentTime > 0
                ? 'Reprise prête'
                : 'Prêt'
              : 'Aucune bande';

  const toc = useMemo(
    () => (session ? buildBookToc(session.chapters, session.title) : null),
    [session]
  );
  const activeTocEntry = toc?.entries[activeChapterIndex] ?? null;

  const cassetteChapterLabel =
    activeChapter?.translationStatus === 'needs_translation'
      ? `${activeTocEntry?.displayTitle ?? `Section ${activeChapterIndex + 1}`} (à traduire)`
      : activeTocEntry?.displayTitle ?? activeChapter?.title ?? '';

  const cassetteTopBadge =
    session && toc ? formatTocCompactBadge(toc, activeChapterIndex) : 'FACE A · C-90';

  const isTuningModified =
    Math.abs(speed - 1.0) > 0.01 ||
    Math.abs(pitchSemitones) > 0.05 ||
    Math.abs(pauseDurationSeconds - DEFAULT_PAUSE_DURATION_SECONDS) > 0.01;
  const totalBookSegments = session
    ? session.chapters.reduce((sum, ch) => sum + ch.segments.length, 0)
    : 0;

  return (
    <section
      id="lecteur"
      aria-label="Baladeur Walkman Sonobande"
      data-testid="walkman-deck"
      data-transport-state={transportState}
      className="relative flex items-start"
    >
      {/* Main Brushed Aluminum Walkman Chassis */}
      <div className="walkman-aluminum relative z-10 min-w-0 flex-1 rounded-2xl border border-[#aba69b] p-4 sm:p-5">
        {/* Hardware Silkscreen Header Strip */}
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2 px-1">
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-sm font-bold tracking-[0.14em] text-[#22252a]">
              SONOBANDE
            </span>
            <span className="text-xs font-medium text-[#55585e]">
              {'Voix neuronale illimitée'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-medium text-[#3b3e44]">
            {isBuffering ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#d9531e]" aria-hidden="true" />
            ) : (isPlaying || isExporting) ? (
              <span
                className="inline-block h-2 w-2 rounded-full bg-[#d9531e]"
                aria-hidden="true"
              />
            ) : null}
            <span data-testid="walkman-status" className="font-mono">
              {statusText}
            </span>
            <button
              type="button"
              onClick={onEnterFullscreen}
              disabled={!hasBook}
              data-testid="deck-fullscreen-btn"
              aria-label="Ouvrir le mode écoute plein écran"
              title="Mode écoute plein écran"
              className="inline-flex items-center gap-1 rounded-md border border-[#b2ada2] bg-[#ece9e2] px-2 py-1 text-[11px] font-semibold text-[#1c1e21] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Maximize2 className="h-3 w-3 text-[#d9531e]" aria-hidden="true" />
              <span>Plein écran</span>
            </button>
          </div>
        </div>

        {/* Smoked Acrylic Cassette Bay */}
        <div className="walkman-graphite relative flex flex-col justify-between overflow-hidden rounded-xl border-2 border-[#393c42] px-3 pt-4 pb-4 sm:px-4 sm:pt-5 sm:pb-5">
          <span
            aria-hidden="true"
            className="absolute top-2 left-2 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
          />
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
          />
          <span
            aria-hidden="true"
            className="absolute bottom-2 left-2 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
          />
          <span
            aria-hidden="true"
            className="absolute right-2 bottom-2 h-2 w-2 rounded-full border border-[#4f535b] bg-[#2a2d33]"
          />

          {/* Vertical Cassette Shell Window (classic upright Walkman orientation) */}
          <div className="mx-auto w-full max-w-[290px] rounded-xl border border-[#444851] bg-[#16181b] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:p-3">
            {/* Cassette body: vertical label on the left + vertical dual-reel window on the right */}
            <div className="grid min-h-[295px] grid-cols-[1fr_80px] items-stretch gap-2 sm:min-h-[335px] sm:grid-cols-[1fr_94px] sm:gap-2.5">
              {/* Vertical Cassette Paper Label */}
              <div className="flex min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-[#383a3e] bg-[#f4f1ea] text-[#1c1e21]">
                {/* Top orange cassette header stripe */}
                <div
                  className="flex flex-col gap-0.5 px-2 py-1.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: '#D9531E' }}
                >
                  <span className="font-mono truncate">
                    {cassetteTopBadge}
                  </span>
                  <span className="font-mono text-[9px] text-white/90">
                    {session
                      ? `Segment ${activeSegmentIndex + 1} / ${Math.max(1, totalSegmentsInChapter)}`
                      : 'Bande locale'}
                  </span>
                </div>

                {/* Label body with vertical Walkman orange accent bar */}
                <div className="relative flex flex-1 flex-col justify-between border-l-4 border-[#d9531e] px-2 py-2.5 sm:px-2.5 sm:py-3">
                  {session && activeChapter ? (
                    <div className="min-w-0 space-y-1.5">
                      <p className="line-clamp-3 font-display text-xs font-bold leading-snug text-[#1c1e21] sm:text-sm">
                        {session.title}
                      </p>
                      <p
                        data-testid="active-cassette-title"
                        className="line-clamp-3 text-[11px] font-semibold leading-snug text-[#3a3d42] sm:text-xs"
                      >
                        {cassetteChapterLabel}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-1 pt-0.5 text-[10px] text-[#5c5f66] sm:text-[11px]">
                        <span>{`Voix ${neuralVoiceProfile.name}`}</span>
                        <span aria-hidden="true">·</span>
                        <span>{statusText}</span>
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-start gap-2 py-2 text-[11px] text-[#55585e] sm:text-xs">
                      <Disc3 className="h-5 w-5 text-[#b93e0e]" aria-hidden="true" />
                      <span className="leading-relaxed">
                        Importez un livre PDF/EPUB ou collez un texte pour commencer.
                      </span>
                    </div>
                  )}

                  {/* Chapter progress + prev/next micro buttons inside label footer */}
                  <div className="mt-3 border-t border-[#dfd8ca] pt-2">
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#dbd4c6]">
                        <div
                          className="h-full transition-all duration-150"
                          style={{
                            width: `${Math.round(chapterProgressRatio * 100)}%`,
                            backgroundColor: '#D9531E',
                          }}
                        />
                      </div>
                      <span className="font-mono text-[10px] font-semibold tabular-nums text-[#4a473f]">
                        {Math.round(chapterProgressRatio * 100)}%
                      </span>
                    </div>

                    {totalChapters > 1 && (
                      <div className="mt-2 flex items-center justify-between gap-1">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-[#6d695f]">
                          Chap.
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={onPrevChapter}
                            disabled={activeChapterIndex <= 0}
                            aria-label="Chapitre précédent"
                            className="flex h-6 w-6 items-center justify-center rounded border border-[#c5bfb3] bg-white text-[#1c1e21] hover:bg-[#efece4] disabled:opacity-35"
                          >
                            <SkipBack className="h-3 w-3" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={onNextChapter}
                            disabled={activeChapterIndex >= totalChapters - 1}
                            aria-label="Chapitre suivant"
                            className="flex h-6 w-6 items-center justify-center rounded border border-[#c5bfb3] bg-white text-[#1c1e21] hover:bg-[#efece4] disabled:opacity-35"
                          >
                            <SkipForward className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Vertical Smoked Transparent Dual-Reel Window (top & bottom reels) */}
              <div className="relative flex flex-col items-center justify-between rounded-lg border border-[#2d3036] bg-[#0e1012] px-1 py-3 shadow-inner sm:py-4">
                {/* Vertical magnetic tape path connecting the two reels */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-9 left-1/2 w-[2px] -translate-x-1/2 bg-gradient-to-b from-[#3d3128] via-[#5e4736] to-[#3d3128] opacity-65"
                />

                <div className="relative z-10">
                  <ReelWheel
                    spinning={isPlaying || isBuffering}
                    spinDurationSec={spinDurationSec}
                    tapeRadius={leftTapeRadius}
                  />
                </div>

                <div className="relative z-10 my-1.5 flex flex-col items-center gap-1">
                  <div className="h-12 w-1.5 overflow-hidden rounded-full bg-[#24272c]">
                    <div
                      className="w-full transition-all duration-150"
                      style={{
                        height: `${Math.round(chapterProgressRatio * 100)}%`,
                        backgroundColor: '#D9531E',
                      }}
                    />
                  </div>
                  <span className="font-mono text-[8px] tracking-widest text-[#8e929b]">
                    TAPE
                  </span>
                </div>

                <div className="relative z-10">
                  <ReelWheel
                    spinning={isPlaying || isBuffering}
                    spinDurationSec={spinDurationSec}
                    tapeRadius={rightTapeRadius}
                  />
                </div>
              </div>
            </div>

            {/* Bottom Cassette Head / Capstan Alignment Notch */}
            <div
              aria-hidden="true"
              className="mx-auto mt-2 flex h-3.5 w-4/5 items-center justify-between rounded-b-md border border-t-0 border-[#2f3239] bg-[#101215] px-4"
            >
              <span className="h-1.5 w-1.5 rounded-full border border-[#4a4e57] bg-[#1e2026]" />
              <span className="h-1 w-9 rounded-full bg-[#2b2e36]" />
              <span className="h-1.5 w-1.5 rounded-full border border-[#4a4e57] bg-[#1e2026]" />
            </div>
          </div>

          {/* Analog VU Meter & Mechanical Tape Counter */}
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-[#3a3d43] bg-[#efe9da] px-2.5 py-1.5 text-[#1e2024]">
              <span className="font-mono text-[10px] font-semibold text-[#4b473e]">VU</span>
              <div className="relative h-8 w-28 overflow-hidden">
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
              <span className="font-mono text-[10px] text-[#d9531e]">+3</span>
            </div>

            <div className="flex flex-col justify-center rounded-lg border border-[#3a3d43] bg-[#111316] px-3 py-1.5">
              <span className="text-[10px] font-medium tracking-wide text-[#9fa3ab]">
                {segmentDuration <= 0 && segmentCurrentTime > 0
                  ? 'Reprise mémorisée'
                  : 'Segment'}
              </span>
              <div
                data-testid="walkman-counter"
                className="mt-0.5 font-mono text-xs font-medium tracking-wider tabular-nums text-[#f3efe6] whitespace-nowrap sm:text-sm"
              >
                {segmentDuration <= 0 && segmentCurrentTime > 0 ? (
                  <>
                    <span className="text-[#f07645]">{formatTimecode(segmentCurrentTime)}</span>
                    <span className="ml-1.5 text-[10px] text-[#a5a9b1]">prêt</span>
                  </>
                ) : (
                  <>
                    <span>{formatTimecode(segmentCurrentTime)}</span>
                    <span className="mx-1 text-[#6e727a]">/</span>
                    <span className="text-[#a5a9b1]">{formatTimecode(effectiveDuration)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Segment Position Scrubber */}
          <div className="mt-3 flex items-center gap-3 px-0.5">
            <label htmlFor="tape-scrubber" className="sr-only">
              Position dans le segment audio
            </label>
            <input
              id="tape-scrubber"
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
        </div>

      {/* Quick Intuitive Voice Selector directly on the Walkman */}
      <div className="mt-4 rounded-xl border border-[#b6b1a6] bg-[#dedbd3] px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-display text-xs font-semibold text-[#1c1e21]">
            <span>Voix française</span>
            <span className="rounded bg-[#ece9e2] px-1.5 py-0.5 font-mono text-[10px] font-medium text-[#2c5e3b]">
              Mémorisée
            </span>
          </span>
          <div className="flex items-center gap-1.5">
            {voiceStatuses[neuralVoiceId]?.installState === 'installed' && (
              <>
                <button
                  type="button"
                  disabled={
                    voiceStatuses[neuralVoiceId]?.healthState === 'testing' || isExporting
                  }
                  onClick={() => onTestVoice(neuralVoiceId)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#b8b3a8] bg-[#f4f1ea] px-2 py-0.5 text-[11px] font-semibold text-[#1c1e21] hover:bg-white disabled:opacity-45"
                >
                  {voiceStatuses[neuralVoiceId]?.healthState === 'testing' ? (
                    <Loader2 className="h-3 w-3 animate-spin text-[#d9531e]" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-3 w-3 text-[#d9531e]" aria-hidden="true" />
                  )}
                  <span>Écouter</span>
                </button>
                <button
                  type="button"
                  disabled={isExporting}
                  onClick={() => onDeleteVoice(neuralVoiceId)}
                  aria-label={`Supprimer la voix ${neuralVoiceProfile.name}`}
                  title={`Supprimer la voix ${neuralVoiceProfile.name} du navigateur`}
                  className="inline-flex items-center justify-center rounded-md border border-[#d6b7ad] bg-[#fbefeb] p-1 text-[#8a280b] hover:bg-[#f6dfd8] disabled:opacity-45"
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </div>
        <div
          role="group"
          aria-label="Choisir la voix sur le Walkman"
          className="grid grid-cols-2 gap-1.5"
        >
          {NEURAL_FRENCH_VOICES.map((voice) => {
            const status = voiceStatuses[voice.id];
            const isSelected = voice.id === neuralVoiceId;
            const isInstalled = status?.installState === 'installed';
            const isDownloading = status?.installState === 'downloading';
            const isFailed = status?.healthState === 'failed' || status?.installState === 'error';
            const isWorking = isInstalled && status?.healthState === 'working';
            const isUnsupported = status?.installState === 'unsupported';

            return (
              <button
                key={voice.id}
                type="button"
                disabled={isDownloading || isUnsupported}
                onClick={() => onSelectOrDownloadVoice(voice.id)}
                aria-pressed={isSelected}
                title={
                  isInstalled
                    ? `Utiliser la voix ${voice.name} (${voice.gender} · ${voice.timbre})`
                    : `Télécharger et utiliser ${voice.name} (~${voice.approxSizeMb} Mo)`
                }
                className={`flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-60 ${
                  isSelected
                    ? 'border-[#1c1e21] bg-[#1c1e21] text-[#f7f5f0]'
                    : 'border-[#b3aea3] bg-[#ece9e2] text-[#1c1e21] hover:bg-[#f7f5f0]'
                }`}
              >
                <div className="flex w-full items-center justify-between gap-1">
                  <span className="truncate text-xs font-bold">{voice.name}</span>
                  {isDownloading ? (
                    <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px]">
                      <Loader2 className="h-3 w-3 animate-spin text-[#f07645]" aria-hidden="true" />
                      {status.downloadPercent > 0 ? `${status.downloadPercent}%` : ''}
                    </span>
                  ) : isFailed ? (
                    <AlertCircle
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#f6a58e]' : 'text-[#b93e0e]'}`}
                      aria-hidden="true"
                    />
                  ) : isInstalled ? (
                    <CheckCircle2
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#7ad096]' : 'text-[#2c5e3b]'}`}
                      aria-hidden="true"
                    />
                  ) : (
                    <Download
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#f07645]' : 'text-[#8f2e08]'}`}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <span
                  className={`truncate text-[10px] ${
                    isSelected ? 'text-[#d1cdc4]' : 'text-[#55585e]'
                  }`}
                >
                  {isDownloading
                    ? 'Téléchargement…'
                    : isFailed
                      ? 'Erreur — réessayer'
                      : !isInstalled
                        ? `Télécharger · ~${voice.approxSizeMb} Mo`
                        : isWorking
                          ? `${voice.gender} · Fonctionne`
                          : `${voice.gender} · ${voice.timbre}`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Collapsible Intuitive Voice Options: clear presets + saved summary */}
      <div className="mt-3 rounded-xl border border-[#b6b1a6] bg-[#dedbd3]">
        <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
          <button
            type="button"
            onClick={toggleShowTuning}
            aria-expanded={showTuning}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[#b93e0e]" aria-hidden="true" />
              <span className="font-display text-xs font-semibold text-[#1c1e21] sm:text-sm">
                Options de la voix
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-[11px] font-medium tabular-nums text-[#4a4d52]">
                {speed.toFixed(2)}× · {describePitchShort(pitchSemitones)} · Vol. {Math.round((muted ? 0 : volume) * 100)}%{hdVoiceEnhanced ? ' · HD' : ''}
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-[#4a4d52] transition-transform ${
                  showTuning ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </span>
          </button>

          {isTuningModified && (
            <button
              type="button"
              onClick={onResetTuning}
              title="Réinitialiser les options de la voix"
              className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-[#b93e0e] transition-colors hover:bg-[#d2cec5] hover:text-[#8f2e08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only sm:not-sr-only">Reset</span>
            </button>
          )}
        </div>

        {showTuning && (
          <div className="space-y-4 border-t border-[#c6c1b6] px-4 py-3.5">
            {/* Voice Volume (persisted automatically) */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="voice-volume-slider" className="text-xs font-semibold text-[#2e3136]">
                  Volume de la voix
                </label>
                <span className="font-mono text-xs font-semibold tabular-nums text-[#1c1e21]">
                  {muted || volume === 0 ? 'Muet' : `${Math.round(volume * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-label={muted ? 'Réactiver la voix' : 'Couper la voix'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#b3aea3] bg-[#ece9e2] text-[#25272b] hover:bg-[#f7f5f0]"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="h-3.5 w-3.5 text-[#b93e0e]" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                <input
                  id="voice-volume-slider"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => onVolumeChange(Number(e.target.value))}
                  className="walkman-fader w-full"
                />
              </div>
            </div>

            <hr className="border-[#c6c1b6]" />

            {/* Speed with intuitive human labels */}
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
              <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {SPEED_PRESETS.map((preset) => {
                  const active = Math.abs(speed - preset.value) < 0.03;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onSpeedChange(preset.value)}
                      className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d9531e] ${
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
            </div>

            <hr className="border-[#c6c1b6]" />

            {/* Timbre / Pitch with plain French labels */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="pitch-slider" className="text-xs font-semibold text-[#2e3136]">
                  Timbre de la voix
                </label>
                <span
                  data-testid="pitch-value"
                  className="font-mono text-xs font-semibold tabular-nums text-[#1c1e21]"
                >
                  {describePitchShort(pitchSemitones)} ({formatPitchLabel(pitchSemitones)})
                </span>
              </div>
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                {PITCH_PRESETS.map((preset) => {
                  const active = Math.abs(pitchSemitones - preset.value) < 0.3;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onPitchChange(preset.value)}
                      className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d9531e] ${
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
            </div>

            <hr className="border-[#c6c1b6]" />

            {/* Breathing / Pauses between sentences with simple presets */}
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label htmlFor="pause-duration-slider" className="text-xs font-semibold text-[#2e3136]">
                  Respiration entre phrases
                </label>
                <span className="font-mono text-xs font-semibold tabular-nums text-[#1c1e21]">
                  {pauseDurationSeconds === 0 ? 'Aucune' : `${pauseDurationSeconds.toFixed(1)} s`}
                </span>
              </div>
              <div className="mb-2 grid grid-cols-3 gap-1.5">
                {PAUSE_PRESETS.map((preset) => {
                  const active = Math.abs(pauseDurationSeconds - preset.value) < 0.05;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => onPauseDurationChange(preset.value)}
                      className={`rounded-md border px-2 py-1.5 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#d9531e] ${
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
              <input
                id="pause-duration-slider"
                type="range"
                min={0}
                max={1.5}
                step={0.1}
                value={pauseDurationSeconds}
                onChange={(e) => onPauseDurationChange(Number(e.target.value))}
                className="walkman-fader w-full"
              />
            </div>

            <hr className="border-[#c6c1b6]" />

            {/* HD & Fluid Voice Mastering */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-[#2e3136]">
                  <Sparkles className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                  <span>Voix HD &amp; fluide</span>
                </p>
                <p className="mt-0.5 text-[11px] text-[#55585e]">
                  Rend la voix plus nette, douce et régulière (écoute + MP3).
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={hdVoiceEnhanced}
                onClick={onToggleHdVoice}
                className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] ${
                  hdVoiceEnhanced
                    ? 'border-[#1c1e21] bg-[#1c1e21] text-[#f7f5f0]'
                    : 'border-[#b3aea3] bg-[#ece9e2] text-[#35383d] hover:bg-[#f7f5f0]'
                }`}
              >
                {hdVoiceEnhanced ? 'Activé' : 'Désactivé'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Flexible MP3 Export (Chapter or Full Book) */}
      <div className="mt-4 space-y-3">
        {/* Dual MP3 Export Buttons (progress shown in single global bar) */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onExportChapterMp3}
            disabled={!canExport || isExporting}
            className="mech-key inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-4 w-4 text-[#d9531e] shrink-0" aria-hidden="true" />
            <span>{isExporting ? 'Export en cours…' : 'MP3 du chapitre'}</span>
          </button>

          <button
            type="button"
            onClick={onExportBookMp3}
            disabled={!canExport || isExporting}
            className="mech-key inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-4 w-4 text-[#1c1e21] shrink-0" aria-hidden="true" />
            <span>
              {isExporting
                ? 'Encodage dans le worker…'
                : totalChapters > 1
                  ? `MP3 livre entier (${totalBookSegments} seg.)`
                  : 'MP3 complet'}
            </span>
          </button>
        </div>

        {(playbackErrorMessage || exportErrorMessage) && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-[#d49a89] bg-[#fbefeb] px-3 py-2 text-xs text-[#8a280b]"
          >
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{playbackErrorMessage || exportErrorMessage}</span>
          </div>
        )}

        {exportSuccessMessage && !readyMp3 && !isExporting && (
          <p
            role="status"
            className="rounded-lg border border-[#cfc9bd] bg-[#efece4] px-3 py-2 text-xs text-[#3b3e44]"
          >
            {exportSuccessMessage}
          </p>
        )}

        {readyMp3 && !isExporting && (
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
      </div>

      {/* Protruding Right-Edge Mechanical Walkman Keys (physically emerging from the side flank) */}
      <div
        role="group"
        aria-label="Commandes mécaniques du baladeur"
        className="relative z-0 -ml-[3px] flex w-[54px] shrink-0 flex-col gap-2.5 pt-16 sm:w-[62px] sm:gap-3 sm:pt-20"
      >
        {/* Recessed dark slot housing along the aluminum edge */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-14 bottom-1 left-0 w-2 rounded-r bg-[#23252a] shadow-inner sm:top-18"
        />

        {/* PLAY — iconic protruding Walkman orange key (wider/taller) */}
        <button
          type="button"
          onClick={onPlay}
          disabled={!hasBook || isExporting}
          aria-pressed={isPlaying}
          aria-label="Lire le chapitre actif"
          className={`mech-side-key-orange relative flex min-h-[76px] w-full flex-col items-center justify-center gap-1 pl-2 pr-2.5 py-2.5 text-[10px] font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[84px] sm:text-[11px] ${
            isPlaying || isBuffering ? 'mech-side-key-pressed' : ''
          }`}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 right-1 bottom-2.5 flex flex-col justify-center gap-1 opacity-45"
          >
            <span className="h-3 w-[2px] rounded-full bg-white" />
            <span className="h-3 w-[2px] rounded-full bg-white" />
          </span>
          <Play className="h-4 w-4 fill-current sm:h-5 sm:w-5" aria-hidden="true" />
          <span className="whitespace-nowrap">PLAY</span>
        </button>

        {/* PAUSE */}
        <button
          type="button"
          onClick={onPause}
          disabled={!hasBook || (!isPlaying && !isBuffering)}
          aria-pressed={isPaused}
          aria-label="Mettre la lecture en pause"
          className={`mech-side-key relative flex min-h-[58px] w-[92%] flex-col items-center justify-center gap-1 pl-2 pr-2 py-2 text-[9px] font-bold tracking-wide text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[62px] sm:text-[10px] ${
            isPaused ? 'mech-side-key-pressed !border-[#d9531e] !text-[#b93e0e]' : ''
          }`}
        >
          <Pause className="h-3.5 w-3.5 fill-current sm:h-4 sm:w-4" aria-hidden="true" />
          <span className="whitespace-nowrap">PAUSE</span>
        </button>

        {/* STOP */}
        <button
          type="button"
          onClick={onStop}
          disabled={!hasBook}
          aria-label="Arrêter la lecture en conservant la position"
          title="Arrêter (conserve la position)"
          className="mech-side-key relative flex min-h-[58px] w-[92%] flex-col items-center justify-center gap-1 pl-2 pr-2 py-2 text-[9px] font-bold tracking-wide text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[62px] sm:text-[10px]"
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
          className="mech-side-key relative flex min-h-[56px] w-[88%] flex-col items-center justify-center gap-1 pl-2 pr-2 py-2 text-[9px] font-bold tracking-wide text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[60px] sm:text-[10px]"
        >
          <Rewind className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          <span className="whitespace-nowrap">REW</span>
        </button>

        {/* FF */}
        <button
          type="button"
          onClick={onFastForward}
          disabled={!hasBook || isExporting}
          aria-label="Avance rapide"
          className="mech-side-key relative flex min-h-[56px] w-[88%] flex-col items-center justify-center gap-1 pl-2 pr-2 py-2 text-[9px] font-bold tracking-wide text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[60px] sm:text-[10px]"
        >
          <FastForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          <span className="whitespace-nowrap">FF</span>
        </button>

        {/* NEXT CHAPTER */}
        <button
          type="button"
          onClick={onNextChapter}
          disabled={!hasBook || activeChapterIndex >= totalChapters - 1}
          aria-label="Chapitre suivant"
          className="mech-side-key relative flex min-h-[56px] w-[88%] flex-col items-center justify-center gap-1 pl-2 pr-2 py-2 text-[9px] font-bold tracking-wide text-[#1f2125] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:opacity-45 sm:min-h-[60px] sm:text-[10px]"
        >
          <SkipForward className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
          <span className="whitespace-nowrap">SUIV.</span>
        </button>
      </div>
    </section>
  );
}
