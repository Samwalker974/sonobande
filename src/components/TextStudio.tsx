import {
  AlertCircle,
  Eraser,
  FileUp,
  Languages,
  Loader2,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useRef, useState } from 'react';
import {
  FRENCH_SAMPLE_SCRIPTS,
  getNeuralVoiceById,
} from '../constants/voices';
import type {
  BookSession,
  NeuralVoiceId,
  SampleScript,
  TranslationProgress,
} from '../types/walkman';
import { estimateFrenchSpeechSeconds, formatLongDuration } from '../utils/bookSplitter';
import { detectLikelyEnglish } from '../utils/languageDetect';

interface TextStudioProps {
  session: BookSession | null;
  neuralVoiceId: NeuralVoiceId;
  draftTitle: string;
  draftText: string;
  speed: number;
  isImportingFile: boolean;
  importStatusLabel: string | null;
  autoTranslateToFrench: boolean;
  translationProgress: TranslationProgress | null;
  errorMessage: string | null;
  onDraftTitleChange: (title: string) => void;
  onDraftTextChange: (text: string) => void;
  onImportFile: (file: File) => void;
  onLoadPastedText: (autoPlay: boolean) => void;
  onLoadSample: (sample: SampleScript) => void;
  onToggleAutoTranslate: () => void;
  onTranslateAllChapters: () => void;
  onClearDraft: () => void;
}

export function TextStudio({
  session,
  neuralVoiceId,
  draftTitle,
  draftText,
  speed,
  isImportingFile,
  importStatusLabel,
  autoTranslateToFrench,
  translationProgress,
  errorMessage,
  onDraftTitleChange,
  onDraftTextChange,
  onImportFile,
  onLoadPastedText,
  onLoadSample,
  onToggleAutoTranslate,
  onTranslateAllChapters,
  onClearDraft,
}: TextStudioProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const selectedNeuralVoice = getNeuralVoiceById(neuralVoiceId);
  const charCount = draftText.length;
  const estimatedSeconds = estimateFrenchSpeechSeconds(draftText, speed);
  const draftLooksEnglish = !session && draftText.trim().length > 24 && detectLikelyEnglish(draftText) === 'en';
  const showEnglishBar = session?.detectedLanguage === 'en' || draftLooksEnglish;
  const translatedCount = session
    ? session.chapters.filter((ch) => ch.translationStatus === 'translated').length
    : 0;
  const remainingToTranslate = session
    ? session.chapters.filter((ch) => ch.translationStatus === 'needs_translation').length
    : 0;
  const translatingChapterLabels =
    session?.chapters.flatMap((chapter, index) =>
      chapter.translationStatus === 'translating' ? [`Chapitre ${index + 1}`] : []
    ) ?? [];

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      onImportFile(file);
    }
  };

  return (
    <section
      id="document"
      aria-label="Ajouter un livre ou un texte"
      className="flex h-full flex-col justify-between rounded-2xl border border-[#d4cfc4] bg-[#f7f5f0] p-4 sm:p-6"
    >
      <div className="flex flex-1 flex-col">
        {/* Header + concise badges */}
        <div className="mb-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-display text-xl font-bold tracking-tight text-[#1c1e21] sm:text-2xl [text-wrap:balance]">
              Ajouter un livre ou un texte
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#c8d8cc] bg-[#eef5ef] px-2.5 py-0.5 text-[11px] font-medium text-[#224b2f]">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              <span>100 % local · Voix {selectedNeuralVoice.name}</span>
            </span>
          </div>
          <p className="mt-1 text-xs text-[#55585e] sm:text-sm">
            Importez un fichier (PDF, EPUB, TXT) ou collez votre texte, puis lancez l&apos;écoute.
          </p>
        </div>

        {/* Step 1: Local PDF / EPUB / TXT Dropzone */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-[#34373c]">
            1. Importer un fichier
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-col items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors sm:flex-row ${
              isDragging
                ? 'border-[#d9531e] bg-[#fbefeb]'
                : 'border-[#bdb7aa] bg-[#f1eee6]'
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#e4dfd4] text-[#25272b]">
                {isImportingFile ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[#d9531e]" aria-hidden="true" />
                ) : (
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                )}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1c1e21]">
                  {isImportingFile
                    ? importStatusLabel || 'Lecture du fichier…'
                    : 'Glisser un PDF, EPUB ou TXT ici'}
                </p>
                <p className="text-xs text-[#5b5e64]">
                  Jusqu’à 20 Mo · découpage en chapitres et traduction EN → FR automatiques
                </p>
              </div>
            </div>

            <div className="shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onImportFile(file);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={isImportingFile}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg border border-[#b9b3a6] bg-white px-3.5 py-2 text-xs font-semibold text-[#1c1e21] whitespace-nowrap transition-colors hover:bg-[#faf8f4] focus-visible:outline-2 focus-visible:outline-[#d9531e] disabled:opacity-50"
              >
                Choisir un fichier
              </button>
            </div>
          </div>
        </div>

        {/* English -> French Translation Bar (appears automatically when English is detected) */}
        {showEnglishBar && (
          <div
            data-testid="english-translation-bar"
            className="mt-4 rounded-xl border border-[#d6c9b8] bg-[#f3ece0] px-4 py-3"
          >
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <Languages
                  className="mt-0.5 h-4 w-4 shrink-0 text-[#d9531e]"
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-[#1c1e21]">
                    Texte anglais détecté · traduction en français sur cet appareil
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#55585e]">
                    {translationProgress || translatingChapterLabels.length > 0 ? (
                      <span role="status" className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin text-[#d9531e]" aria-hidden="true" />
                        <span>
                          {translationProgress
                            ? translationProgress.currentLabel
                            : `Traduction en cours — ${translatingChapterLabels.join(', ')}`}
                        </span>
                      </span>
                    ) : session ? (
                      <>
                        {translatedCount} / {session.chapters.length} chapitres déjà traduits
                        {' · '}
                        {remainingToTranslate === 1
                          ? '1 à traduire'
                          : `${remainingToTranslate} à traduire`}
                      </>
                    ) : (
                      'La première traduction peut télécharger le modèle. Il sera ensuite conservé dans le cache du navigateur.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoTranslateToFrench}
                  onClick={onToggleAutoTranslate}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-[#d9531e] ${
                    autoTranslateToFrench
                      ? 'border-[#1c1e21] bg-[#1c1e21] text-[#f7f5f0]'
                      : 'border-[#c5bfb3] bg-white text-[#35383d] hover:bg-[#faf8f4]'
                  }`}
                >
                  <span>
                    Traduction automatique : {autoTranslateToFrench ? 'Activée' : 'Désactivée'}
                  </span>
                </button>

                {session &&
                  remainingToTranslate > 0 &&
                  !translationProgress &&
                  translatingChapterLabels.length === 0 && (
                    <button
                      type="button"
                      onClick={onTranslateAllChapters}
                      data-testid="translate-all-button"
                      className="rounded-lg bg-[#d9531e] px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap transition-colors hover:bg-[#c24515] focus-visible:outline-2 focus-visible:outline-[#1c1e21]"
                    >
                      Traduire tout le livre
                    </button>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Active Loaded File Banner OR Unlimited Paste Box */}
        <div className="mt-4 flex flex-1 flex-col">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label
                htmlFor="french-text-input"
                className="text-xs font-semibold text-[#34373c]"
              >
                2. Ou coller votre texte
              </label>
            </div>
            <div className="flex items-center gap-2.5 text-xs text-[#55585e]">
              <span className="font-mono tabular-nums">
                {charCount.toLocaleString('fr-FR')} car.
              </span>
              {estimatedSeconds > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    ~{formatLongDuration(estimatedSeconds)}
                  </span>
                </>
              )}
            </div>
          </div>

          <input
            id="book-title-input"
            type="text"
            value={draftTitle}
            maxLength={120}
            aria-label="Titre du document ou du livre"
            onChange={(e) => onDraftTitleChange(e.target.value)}
            placeholder="Titre du livre ou du texte (optionnel)"
            className="mb-2 w-full rounded-lg border border-[#cfc9bd] bg-white px-3 py-2 text-sm text-[#1c1e21] placeholder:text-[#8c887f] focus:border-[#d9531e] focus:outline-none"
          />

          <textarea
            id="french-text-input"
            rows={5}
            value={draftText}
            onChange={(e) => onDraftTextChange(e.target.value)}
            placeholder="Collez ici un chapitre, un essai ou un livre complet… Les titres « Chapitre 1 », « Partie 2 », etc. sont découpés automatiquement."
            className="min-h-[126px] w-full flex-1 resize-y rounded-xl border border-[#cfc9bd] bg-white p-3.5 text-[15px] leading-relaxed text-[#1c1e21] placeholder:text-[#8c887f] transition-colors focus:border-[#d9531e] focus:outline-none focus:ring-2 focus:ring-[#d9531e]/20"
          />

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-[#64676d]">Essayer :</span>
              {FRENCH_SAMPLE_SCRIPTS.map((sample) => (
                <button
                  key={sample.id}
                  type="button"
                  onClick={() => onLoadSample(sample)}
                  className="rounded-md border border-[#d6d1c6] bg-[#efece4] px-2.5 py-1 text-xs font-medium text-[#35383d] whitespace-nowrap transition-colors hover:border-[#b9b3a6] hover:bg-white"
                >
                  {sample.title}
                </button>
              ))}
            </div>

            {draftText.length > 0 && (
              <button
                type="button"
                onClick={onClearDraft}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#5e6167] hover:text-[#1c1e21]"
              >
                <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Effacer le texte</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Errors, Quota Recovery & Primary Load/Listen CTA */}
      <div className="mt-4 space-y-3">
        {errorMessage && (
          <div
            role="alert"
            className="flex flex-col gap-2 rounded-lg border border-[#d49a89] bg-[#fbefeb] px-3.5 py-2.5 text-sm text-[#8a280b]"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => onLoadPastedText(true)}
          disabled={!draftText.trim() || isImportingFile}
          className="mech-key-orange flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1c1e21] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Play className="h-4 w-4 fill-current" aria-hidden="true" />
          <span>Écouter ce texte</span>
        </button>
        {!draftText.trim() && (
          <p className="text-center text-xs text-[#64676d]">
            Choisissez un fichier ci-dessus ou collez un texte ici pour l’écouter.
          </p>
        )}
      </div>
    </section>
  );
}
