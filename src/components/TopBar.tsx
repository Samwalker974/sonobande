import { ChevronDown, HardDrive, HelpCircle, Maximize2, Menu, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { BrowserStorageMetrics } from '../types/walkman';
import { formatStorageSizeFr } from '../utils/bookStorage';

interface TopBarProps {
  storageMetrics: BrowserStorageMetrics;
  hasAnyData: boolean;
  hasBook: boolean;
  onEnterFullscreen: () => void;
  onClearAllStorage: () => Promise<void> | void;
}

export function TopBar({
  storageMetrics,
  hasAnyData,
  hasBook,
  onEnterFullscreen,
  onClearAllStorage,
}: TopBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!popoverOpen) {
      setConfirmClear(false);
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setPopoverOpen(false);
      }
    };
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPopoverOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [popoverOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    document.addEventListener('keydown', handleEsc);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleEsc);
    };
  }, [mobileMenuOpen]);

  const usedTextLabel = formatStorageSizeFr(storageMetrics.libraryTextBytes);
  const remainingLabel =
    storageMetrics.remainingBytes !== null
      ? `${formatStorageSizeFr(storageMetrics.remainingBytes)} libres`
      : 'Quota navigateur indisponible';

  const handleConfirmClear = async () => {
    await onClearAllStorage();
    setConfirmClear(false);
    setPopoverOpen(false);
  };

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-[#d4cfc4] bg-[#ece9e2]/95 backdrop-blur-sm">
      <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-5 py-3 sm:gap-8 sm:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Ouvrir le menu de navigation"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#c5bfb3] bg-[#f7f5f0] text-[#1c1e21] transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] md:hidden"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <a
            href="#lecteur"
            className="shrink-0 whitespace-nowrap font-display text-xl font-bold tracking-tight text-[#1c1e21] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Sonobande
          </a>
        </div>

        {/* Zone 2: Concise single-line navigation links matching page order */}
        <nav
          aria-label="Navigation principale"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-[#4a4d52]"
        >
          <a
            href="#lecteur"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[#1c1e21] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Lecteur
          </a>
          <a
            href="#document"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[#1c1e21] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Importer
          </a>
          <a
            href="#liseuse"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[#1c1e21] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Liseuse
          </a>
          <a
            href="#chapitres"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[#1c1e21] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Chapitres
          </a>
          <a
            href="#bibliotheque"
            className="whitespace-nowrap shrink-0 transition-colors hover:text-[#1c1e21] hover:underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#d9531e]"
          >
            Bibliothèque
          </a>
        </nav>

        {/* Zone 3: Fullscreen listening toggle + Browser Storage Remaining Space Metric */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onEnterFullscreen}
            disabled={!hasBook}
            data-testid="topbar-fullscreen-btn"
            aria-label="Passer en mode écoute plein écran"
            title={
              hasBook
                ? 'Mode écoute plein écran (suspend les autres modules)'
                : 'Chargez un livre ou un texte pour activer le mode écoute plein écran'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#c5bfb3] bg-[#f7f5f0] px-2.5 py-1.5 text-xs font-semibold text-[#1c1e21] whitespace-nowrap transition-colors hover:border-[#9e988c] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Maximize2 className="h-3.5 w-3.5 shrink-0 text-[#d9531e]" aria-hidden="true" />
            <span className="hidden sm:inline">Plein écran</span>
          </button>

          <div ref={containerRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setPopoverOpen((prev) => !prev)}
            aria-expanded={popoverOpen}
            aria-controls="storage-metrics-popover"
            data-testid="storage-metric-trigger"
            className="inline-flex items-center gap-2 rounded-lg border border-[#c5bfb3] bg-[#f7f5f0] px-3 py-1.5 text-xs font-medium text-[#1c1e21] whitespace-nowrap transition-colors hover:border-[#9e988c] hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d9531e]"
          >
            <HardDrive className="h-3.5 w-3.5 shrink-0 text-[#d9531e]" aria-hidden="true" />
            <span className="font-mono tabular-nums font-semibold">
              {usedTextLabel}
            </span>
            <span className="hidden text-[#7b786e] sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="hidden font-mono tabular-nums text-[#4a4d52] sm:inline">
              {remainingLabel}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-[#5b5e64] transition-transform ${
                popoverOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          {popoverOpen && (
            <div
              id="storage-metrics-popover"
              data-testid="storage-popover"
              role="dialog"
              aria-label="Espace de stockage du navigateur et options de nettoyage"
              className="absolute right-0 mt-2 w-[330px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#c5bfb3] bg-[#f7f5f0] p-4 shadow-lg"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-sm font-bold text-[#1c1e21]">
                    Stockage navigateur (texte seul)
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#55585e]">
                    Seuls vos livres et marque-pages sont stockés. Aucun MP3 n’est enregistré.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPopoverOpen(false)}
                  aria-label="Fermer les détails de stockage"
                  className="rounded p-1 text-[#5b5e64] hover:bg-[#e8e4db] hover:text-[#1c1e21]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Metrics readout */}
              <div className="mt-3 space-y-2 rounded-lg border border-[#dfd9ce] bg-white p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#55585e]">Bibliothèque ({storageMetrics.booksCount} {storageMetrics.booksCount > 1 ? 'livres' : 'livre'})</span>
                  <span className="font-mono font-semibold tabular-nums text-[#1c1e21]">
                    {usedTextLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#55585e]">Espace restant estimé</span>
                  <span
                    data-testid="storage-remaining-value"
                    className="font-mono font-semibold tabular-nums text-[#2c5e3b]"
                  >
                    {remainingLabel}
                  </span>
                </div>
                {storageMetrics.browserQuotaBytes !== null && (
                  <div className="pt-1">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e6e1d7]">
                      <div
                        className="h-full bg-[#d9531e] transition-all"
                        style={{
                          width: `${Math.max(
                            storageMetrics.libraryTextBytes > 0 ? 2 : 0,
                            Math.min(100, storageMetrics.percentUsed ?? 0)
                          )}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 font-mono text-[10px] tabular-nums text-[#6d7076]">
                      Quota navigateur : {formatStorageSizeFr(storageMetrics.browserQuotaBytes)}
                    </p>
                  </div>
                )}
              </div>

              {/* How to free up space */}
              <div className="mt-3 rounded-lg border border-[#e3ddd2] bg-[#f2eee5] p-3 text-[11px] leading-relaxed text-[#45484e]">
                <p className="flex items-center gap-1.5 font-semibold text-[#1c1e21]">
                  <HelpCircle className="h-3.5 w-3.5 text-[#d9531e]" aria-hidden="true" />
                  <span>Comment vider cet espace ?</span>
                </p>
                <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                  <li>
                    Pour retirer un seul livre, cliquez sur la corbeille dans la section{' '}
                    <a
                      href="#bibliotheque"
                      onClick={() => setPopoverOpen(false)}
                      className="font-semibold text-[#b93e0e] underline underline-offset-2"
                    >
                      Bibliothèque
                    </a>
                    .
                  </li>
                  <li>
                    Pour tout libérer d’un coup, utilisez le bouton <strong>Vider tout le stockage</strong> ci-dessous (ou les paramètres de données du site de votre navigateur).
                  </li>
                </ol>
              </div>

              {/* Inline 2-step Clear All Storage control */}
              <div className="mt-3 border-t border-[#e2ddd3] pt-3">
                {!confirmClear ? (
                  <button
                    type="button"
                    disabled={!hasAnyData}
                    onClick={() => setConfirmClear(true)}
                    data-testid="clear-all-storage-btn"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#1c1e21] px-3.5 py-2 text-xs font-semibold text-[#f7f5f0] transition-colors hover:bg-[#31343a] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Vider tout le stockage du navigateur</span>
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[#8a280b]">
                      Effacer tous les livres et marque-pages sauvegardés ?
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConfirmClear()}
                        data-testid="confirm-clear-all-storage-btn"
                        className="rounded-lg bg-[#b93e0e] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#9b320a]"
                      >
                        Confirmer
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmClear(false)}
                        className="rounded-lg border border-[#c5bfb3] bg-white px-3 py-1.5 text-xs font-medium text-[#25272b] hover:bg-[#f1eee6]"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      </div>
    </header>
    {mobileMenuOpen && (
      <div className="fixed inset-0 z-50 md:hidden">
        <button
          type="button"
          aria-label="Fermer le menu de navigation"
          onClick={() => setMobileMenuOpen(false)}
          className="absolute inset-0 h-full w-full bg-[#1c1e21]/50"
        />
        <aside
          id="mobile-navigation"
          className="relative flex h-full w-[min(18rem,85vw)] flex-col border-r border-[#d4cfc4] bg-[#f7f5f0] p-5 shadow-2xl"
        >
          <div className="mb-6 flex items-center justify-between">
            <span className="font-display text-lg font-bold text-[#1c1e21]">Navigation</span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fermer le menu de navigation"
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#d4cfc4] bg-white text-[#1c1e21] hover:bg-[#ece9e2]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <nav aria-label="Navigation mobile" className="flex flex-col gap-1">
            {[
              ['#lecteur', '1. Lecteur Walkman'],
              ['#document', '2. Importer un livre ou texte'],
              ['#liseuse', '3. Liseuse synchronisée'],
              ['#chapitres', '4. Chapitres & marque-pages'],
              ['#bibliotheque', '5. Ma Bibliothèque'],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-lg px-3 py-3 text-sm font-medium text-[#34373c] transition-colors hover:bg-[#ece9e2] hover:text-[#b93e0e] focus-visible:outline-2 focus-visible:outline-[#d9531e]"
              >
                {label}
              </a>
            ))}
          </nav>
          <p className="mt-auto border-t border-[#dfdad0] pt-4 text-xs leading-relaxed text-[#6d7076]">
            Accédez rapidement à votre livre, votre bibliothèque et vos chapitres.
          </p>
        </aside>
      </div>
    )}
    </>
  );
}
