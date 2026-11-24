import { Check, Download, FileUp, Languages, Loader2, X } from 'lucide-react';
import type { GlobalTaskProgress } from '../types/walkman';

interface GlobalProgressBarProps {
  task: GlobalTaskProgress;
  onCancel?: () => void;
  darkSurface?: boolean;
}

export function GlobalProgressBar({
  task,
  onCancel,
  darkSurface = false,
}: GlobalProgressBarProps) {
  const hasCounter =
    typeof task.completed === 'number' &&
    typeof task.total === 'number' &&
    task.total > 0;

  const computedPercent =
    typeof task.percent === 'number'
      ? Math.max(0, Math.min(100, Math.round(task.percent)))
      : hasCounter
        ? Math.max(0, Math.min(100, Math.round((task.completed! / task.total!) * 100)))
        : null;

  const Icon =
    task.kind === 'export'
      ? Download
      : task.kind === 'translation'
        ? Languages
        : FileUp;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="global-progress-bar"
      data-task-kind={task.kind}
      data-export-stage={task.stage}
      className={
        darkSurface
          ? 'w-full border-b border-[#34373e] bg-[#1e2024] text-[#f4f1ea]'
          : 'sticky top-[57px] z-20 w-full border-b border-[#cfc6b6] bg-[#f4eee4]/95 text-[#1c1e21] shadow-xs backdrop-blur-sm'
      }
    >
      <div className="mx-auto max-w-[1280px] px-4 py-3 sm:px-8">
        {task.steps && task.steps.length > 0 && (
          <div className="mb-2.5 grid grid-cols-3 gap-1.5">
            {task.steps.map((step) => {
              const activeIdx = task.activeStepIndex ?? 1;
              const isDone = activeIdx > step.id;
              const isActive = activeIdx === step.id;
              return (
                <div
                  key={step.id}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${
                    isActive
                      ? darkSurface
                        ? 'border-[#d9531e] bg-[#2f221d] text-[#f8c1aa]'
                        : 'border-[#d9531e] bg-[#fbf1eb] text-[#8f2e08]'
                      : isDone
                        ? darkSurface
                          ? 'border-[#335a3f] bg-[#1b2b20] text-[#9ed6af]'
                          : 'border-[#b9d3bf] bg-[#edf6ef] text-[#224b2f]'
                        : darkSurface
                          ? 'border-[#33363d] bg-[#24272c] text-[#9fa3ab]'
                          : 'border-[#dcd5c9] bg-[#f7f4ee] text-[#6d7076]'
                  }`}
                >
                  {isDone ? (
                    <Check
                      className={`h-3 w-3 shrink-0 ${darkSurface ? 'text-[#7ad096]' : 'text-[#2c5e3b]'}`}
                      aria-hidden="true"
                    />
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
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                darkSurface ? 'bg-[#2a2d33] text-[#f07645]' : 'bg-[#e7dfd1] text-[#b93e0e]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p
                data-testid="global-progress-headline"
                className="text-xs font-semibold sm:text-sm"
              >
                {task.headline}
              </p>
              <p
                data-testid="global-progress-detail"
                className={`mt-0.5 truncate text-[11px] sm:text-xs ${
                  darkSurface ? 'text-[#b2b6be]' : 'text-[#55585e]'
                }`}
              >
                {task.detail}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {hasCounter && (
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  darkSurface ? 'text-[#d8dce2]' : 'text-[#3b3e44]'
                }`}
              >
                {task.completed}/{task.total}
              </span>
            )}
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                data-testid="global-progress-cancel-btn"
                className={
                  darkSurface
                    ? 'inline-flex items-center gap-1 rounded-lg border border-[#4a4e57] bg-[#2a2d33] px-2.5 py-1.5 text-xs font-semibold text-[#f4f1ea] hover:bg-[#353941] focus-visible:outline-2 focus-visible:outline-[#d9531e]'
                    : 'inline-flex items-center gap-1 rounded-lg border border-[#c5bfb3] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#25272b] hover:bg-[#f4f1ea] focus-visible:outline-2 focus-visible:outline-[#d9531e]'
                }
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{task.cancelLabel || 'Annuler'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-2.5">
          <div
            className={`h-1.5 flex-1 overflow-hidden rounded-full ${
              darkSurface ? 'bg-[#32353c]' : 'bg-[#dad3c6]'
            }`}
          >
            {computedPercent !== null ? (
              <div
                className="h-full bg-[#d9531e] transition-[width] duration-200"
                style={{ width: `${Math.max(4, computedPercent)}%` }}
              />
            ) : (
              <div className="h-full w-2/5 rounded-full bg-[#d9531e] opacity-85" />
            )}
          </div>
          {computedPercent !== null && (
            <span
              className={`font-mono text-[11px] tabular-nums ${
                darkSurface ? 'text-[#b2b6be]' : 'text-[#55585e]'
              }`}
            >
              {computedPercent}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
