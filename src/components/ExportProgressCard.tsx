import { Check, Loader2, X } from 'lucide-react';
import type { ExportProgress } from '../types/walkman';

interface ExportProgressCardProps {
  progress: ExportProgress;
  onCancel: () => void;
  compact?: boolean;
}

const STEPS = [
  { id: 1, label: 'Traduction' },
  { id: 2, label: 'Voix & Audio' },
  { id: 3, label: 'Fichier MP3' },
];

export function ExportProgressCard({
  progress,
  onCancel,
  compact = false,
}: ExportProgressCardProps) {
  const percent =
    progress.totalSegments > 0
      ? Math.min(100, Math.round((progress.completedSegments / progress.totalSegments) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="export-progress-card"
      data-export-stage={progress.stage}
      className={`rounded-xl border border-[#c9bda9] bg-[#f3ede2] text-[#1c1e21] ${
        compact ? 'px-4 py-3' : 'p-3.5'
      }`}
    >
      {/* 3-Step Visual Stage Indicator */}
      <div className="mb-2.5 grid grid-cols-3 gap-1.5">
        {STEPS.map((step) => {
          const isDone = progress.stepIndex > step.id;
          const isActive = progress.stepIndex === step.id;
          return (
            <div
              key={step.id}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                isActive
                  ? 'border-[#d9531e] bg-[#fbf1eb] text-[#8f2e08]'
                  : isDone
                    ? 'border-[#b9d3bf] bg-[#edf6ef] text-[#224b2f]'
                    : 'border-[#dcd5c9] bg-[#f7f4ee] text-[#6d7076]'
              }`}
            >
              {isDone ? (
                <Check className="h-3 w-3 shrink-0 text-[#2c5e3b]" aria-hidden="true" />
              ) : isActive ? (
                <Loader2
                  className="h-3 w-3 shrink-0 animate-spin text-[#d9531e]"
                  aria-hidden="true"
                />
              ) : (
                <span className="font-mono text-[10px]">{step.id}.</span>
              )}
              <span className="truncate">{step.label}</span>
            </div>
          );
        })}
      </div>

      {/* Active Stage Headline + Counter */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            data-testid="export-stage-headline"
            className="text-xs font-semibold text-[#1c1e21]"
          >
            {progress.stageHeadline}
          </p>
          <p
            data-testid="export-stage-detail"
            className="mt-0.5 truncate text-[11px] text-[#55585e]"
          >
            {progress.detail}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tabular-nums text-[#3b3e44]">
            {progress.completedSegments}/{Math.max(1, progress.totalSegments)}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 rounded-md border border-[#c5bfb3] bg-white px-2 py-1 text-[11px] font-medium text-[#3b3e44] hover:bg-[#f4f1ea] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
          >
            <X className="h-3 w-3" aria-hidden="true" />
            <span>Annuler</span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-2.5 flex items-center gap-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#dad3c6]">
          <div
            className="h-full bg-[#d9531e] transition-all duration-200"
            style={{ width: `${Math.max(4, percent)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-[#55585e]">{percent}%</span>
      </div>
    </div>
  );
}
