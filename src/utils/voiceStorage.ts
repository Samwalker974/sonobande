import * as vits from '@diffusionstudio/vits-web';
import { DEFAULT_NEURAL_VOICE_ID, NEURAL_FRENCH_VOICES } from '../constants/voices';
import type { NeuralVoiceId } from '../types/walkman';
import { DEFAULT_PAUSE_DURATION_SECONDS } from './audioDsp';

export const MIN_VALID_ONNX_BYTES = 500_000;
export const MIN_VALID_JSON_BYTES = 100;

const SELECTED_VOICE_KEY = 'sonobande:selected-voice';
const HD_VOICE_KEY = 'sonobande:hd-voice-enhanced';
const VOICE_SETTINGS_KEY = 'sonobande:voice-settings:v1';
const VOICE_HEALTH_KEY = 'sonobande:voice-health:v1';
const TUNING_PANEL_OPEN_KEY = 'sonobande:tuning-panel-open';

export interface VoiceListeningSettings {
  voiceId: NeuralVoiceId;
  speed: number;
  pitchSemitones: number;
  pauseDurationSeconds: number;
  hdVoiceEnhanced: boolean;
  volume: number;
  muted: boolean;
  autoTranslateToFrench: boolean;
}

export interface PersistedVoiceHealthEntry {
  state: 'working' | 'failed';
  errorMessage: string | null;
  checkedAt: number;
}

export const DEFAULT_VOICE_LISTENING_SETTINGS: VoiceListeningSettings = {
  voiceId: DEFAULT_NEURAL_VOICE_ID,
  speed: 1.0,
  pitchSemitones: 0,
  pauseDurationSeconds: DEFAULT_PAUSE_DURATION_SECONDS,
  hdVoiceEnhanced: true,
  volume: 0.88,
  muted: false,
  autoTranslateToFrench: true,
};

export interface CachedVoiceInfo {
  installed: boolean;
  sizeBytes: number | null;
}

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null) {
  if (storage !== undefined) return storage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

function clampRounded(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  decimals: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(min, Math.min(max, value));
  const factor = 10 ** decimals;
  return Math.round(clamped * factor) / factor;
}

export function isValidNeuralVoiceId(value: unknown): value is NeuralVoiceId {
  return (
    typeof value === 'string' &&
    NEURAL_FRENCH_VOICES.some((voice) => voice.id === value)
  );
}

export function supportsVoiceModelStorage(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && Boolean(navigator.storage?.getDirectory);
}

export function readSelectedVoiceId(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): NeuralVoiceId {
  try {
    const store = resolveStorage(storage);
    const saved = store?.getItem(SELECTED_VOICE_KEY);
    if (isValidNeuralVoiceId(saved)) {
      return saved;
    }
  } catch {
    // Ignore storage restriction
  }
  return DEFAULT_NEURAL_VOICE_ID;
}

export function writeSelectedVoiceId(
  voiceId: NeuralVoiceId,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  try {
    resolveStorage(storage)?.setItem(SELECTED_VOICE_KEY, voiceId);
  } catch {
    // Ignore storage restriction
  }
}

export function readHdVoicePreference(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): boolean {
  try {
    const store = resolveStorage(storage);
    const saved = store?.getItem(HD_VOICE_KEY);
    if (saved === null || saved === undefined) return true;
    return saved === 'true';
  } catch {
    return true;
  }
}

export function writeHdVoicePreference(
  enabled: boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  try {
    resolveStorage(storage)?.setItem(HD_VOICE_KEY, enabled ? 'true' : 'false');
  } catch {
    // Ignore storage restriction
  }
}

export function readVoiceListeningSettings(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): VoiceListeningSettings {
  const legacyVoiceId = readSelectedVoiceId(storage);
  const legacyHd = readHdVoicePreference(storage);

  try {
    const store = resolveStorage(storage);
    const raw = store?.getItem(VOICE_SETTINGS_KEY);
    if (!raw) {
      return {
        ...DEFAULT_VOICE_LISTENING_SETTINGS,
        voiceId: legacyVoiceId,
        hdVoiceEnhanced: legacyHd,
      };
    }

    const parsed = JSON.parse(raw) as Partial<VoiceListeningSettings>;
    return {
      voiceId: isValidNeuralVoiceId(parsed.voiceId) ? parsed.voiceId : legacyVoiceId,
      speed: clampRounded(parsed.speed, 0.5, 2.0, DEFAULT_VOICE_LISTENING_SETTINGS.speed, 2),
      pitchSemitones: clampRounded(
        parsed.pitchSemitones,
        -6,
        6,
        DEFAULT_VOICE_LISTENING_SETTINGS.pitchSemitones,
        1
      ),
      pauseDurationSeconds: clampRounded(
        parsed.pauseDurationSeconds,
        0,
        1.5,
        DEFAULT_VOICE_LISTENING_SETTINGS.pauseDurationSeconds,
        1
      ),
      hdVoiceEnhanced:
        typeof parsed.hdVoiceEnhanced === 'boolean' ? parsed.hdVoiceEnhanced : legacyHd,
      volume: clampRounded(parsed.volume, 0, 1, DEFAULT_VOICE_LISTENING_SETTINGS.volume, 2),
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : false,
      autoTranslateToFrench:
        typeof parsed.autoTranslateToFrench === 'boolean'
          ? parsed.autoTranslateToFrench
          : DEFAULT_VOICE_LISTENING_SETTINGS.autoTranslateToFrench,
    };
  } catch {
    return {
      ...DEFAULT_VOICE_LISTENING_SETTINGS,
      voiceId: legacyVoiceId,
      hdVoiceEnhanced: legacyHd,
    };
  }
}

export function writeVoiceListeningSettings(
  settings: VoiceListeningSettings,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  const sanitized: VoiceListeningSettings = {
    voiceId: isValidNeuralVoiceId(settings.voiceId)
      ? settings.voiceId
      : DEFAULT_NEURAL_VOICE_ID,
    speed: clampRounded(settings.speed, 0.5, 2.0, DEFAULT_VOICE_LISTENING_SETTINGS.speed, 2),
    pitchSemitones: clampRounded(
      settings.pitchSemitones,
      -6,
      6,
      DEFAULT_VOICE_LISTENING_SETTINGS.pitchSemitones,
      1
    ),
    pauseDurationSeconds: clampRounded(
      settings.pauseDurationSeconds,
      0,
      1.5,
      DEFAULT_VOICE_LISTENING_SETTINGS.pauseDurationSeconds,
      1
    ),
    hdVoiceEnhanced: Boolean(settings.hdVoiceEnhanced),
    volume: clampRounded(settings.volume, 0, 1, DEFAULT_VOICE_LISTENING_SETTINGS.volume, 2),
    muted: Boolean(settings.muted),
    autoTranslateToFrench: Boolean(settings.autoTranslateToFrench),
  };

  try {
    const store = resolveStorage(storage);
    store?.setItem(VOICE_SETTINGS_KEY, JSON.stringify(sanitized));
    store?.setItem(SELECTED_VOICE_KEY, sanitized.voiceId);
    store?.setItem(HD_VOICE_KEY, sanitized.hdVoiceEnhanced ? 'true' : 'false');
  } catch {
    // Ignore storage restriction
  }
}

export function readVoiceHealthMap(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): Partial<Record<NeuralVoiceId, PersistedVoiceHealthEntry>> {
  try {
    const raw = resolveStorage(storage)?.getItem(VOICE_HEALTH_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<PersistedVoiceHealthEntry>>;
    const result: Partial<Record<NeuralVoiceId, PersistedVoiceHealthEntry>> = {};
    for (const [id, entry] of Object.entries(parsed)) {
      if (!isValidNeuralVoiceId(id)) continue;
      if (entry?.state !== 'working' && entry?.state !== 'failed') continue;
      result[id] = {
        state: entry.state,
        errorMessage: typeof entry.errorMessage === 'string' ? entry.errorMessage : null,
        checkedAt: typeof entry.checkedAt === 'number' ? entry.checkedAt : 0,
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function writeVoiceHealthEntry(
  voiceId: NeuralVoiceId,
  state: 'working' | 'failed',
  errorMessage: string | null = null,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  try {
    const current = readVoiceHealthMap(storage);
    current[voiceId] = {
      state,
      errorMessage: state === 'failed' ? errorMessage : null,
      checkedAt: Date.now(),
    };
    resolveStorage(storage)?.setItem(VOICE_HEALTH_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage restriction
  }
}

export function clearVoiceHealthEntry(
  voiceId: NeuralVoiceId,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  try {
    const current = readVoiceHealthMap(storage);
    if (!(voiceId in current)) return;
    delete current[voiceId];
    resolveStorage(storage)?.setItem(VOICE_HEALTH_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage restriction
  }
}

export function readTuningPanelOpen(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): boolean {
  try {
    return resolveStorage(storage)?.getItem(TUNING_PANEL_OPEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeTuningPanelOpen(
  open: boolean,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): void {
  try {
    resolveStorage(storage)?.setItem(TUNING_PANEL_OPEN_KEY, open ? 'true' : 'false');
  } catch {
    // Ignore storage restriction
  }
}

export async function inspectCachedVoice(voiceId: NeuralVoiceId): Promise<CachedVoiceInfo> {
  if (!supportsVoiceModelStorage()) {
    return { installed: false, sizeBytes: null };
  }

  try {
    const originDirectory = await navigator.storage.getDirectory();
    const piperDirectory = await originDirectory.getDirectoryHandle('piper');
    const onnxHandle = await piperDirectory.getFileHandle(`${voiceId}.onnx`);
    const jsonHandle = await piperDirectory.getFileHandle(`${voiceId}.onnx.json`);
    const [onnxFile, jsonFile] = await Promise.all([
      onnxHandle.getFile(),
      jsonHandle.getFile(),
    ]);

    if (onnxFile.size < MIN_VALID_ONNX_BYTES || jsonFile.size < MIN_VALID_JSON_BYTES) {
      return { installed: false, sizeBytes: null };
    }

    JSON.parse(await jsonFile.text());
    return {
      installed: true,
      sizeBytes: onnxFile.size + jsonFile.size,
    };
  } catch {
    return { installed: false, sizeBytes: null };
  }
}

export async function inspectAllCachedVoices(): Promise<Record<NeuralVoiceId, CachedVoiceInfo>> {
  // Clean up deprecated Piper v1 130-symbol voice if it was downloaded earlier
  if (supportsVoiceModelStorage()) {
    try {
      const originDirectory = await navigator.storage.getDirectory();
      const piperDirectory = await originDirectory.getDirectoryHandle('piper');
      for (const fileName of ['fr_FR-gilles-low.onnx', 'fr_FR-gilles-low.onnx.json']) {
        try {
          await piperDirectory.removeEntry(fileName);
        } catch {
          // Not present
        }
      }
    } catch {
      // Directory not present
    }
  }

  const entries = await Promise.all(
    NEURAL_FRENCH_VOICES.map(async (voice) => [voice.id, await inspectCachedVoice(voice.id)] as const)
  );
  return Object.fromEntries(entries) as Record<NeuralVoiceId, CachedVoiceInfo>;
}

export async function waitForVoiceModelReady(
  voiceId: NeuralVoiceId,
  attempts = 60
): Promise<CachedVoiceInfo> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const info = await inspectCachedVoice(voiceId);
    if (info.installed) return info;
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
  return { installed: false, sizeBytes: null };
}

export async function downloadVoiceModel(
  voiceId: NeuralVoiceId,
  onProgress?: (percent: number) => void
): Promise<CachedVoiceInfo> {
  if (!supportsVoiceModelStorage()) {
    throw new Error(
      'Le stockage des modèles vocaux exige une origine sécurisée (localhost ou HTTPS).'
    );
  }

  await vits.download(voiceId, (progress) => {
    if (progress.total > 0) {
      onProgress?.(Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100))));
    }
  });

  const verified = await waitForVoiceModelReady(voiceId);
  if (!verified.installed) {
    throw new Error(
      'Le modèle a été téléchargé mais les fichiers n’ont pas pu être vérifiés dans le stockage du navigateur.'
    );
  }

  try {
    window.localStorage.setItem(`sonobande:voice:${voiceId}:installed`, 'true');
  } catch {
    // Ignore storage restriction
  }

  return verified;
}

export async function removeVoiceModel(voiceId: NeuralVoiceId): Promise<void> {
  try {
    window.localStorage.removeItem(`sonobande:voice:${voiceId}:installed`);
  } catch {
    // Ignore storage restriction
  }
  clearVoiceHealthEntry(voiceId);

  if (!supportsVoiceModelStorage()) return;

  try {
    await vits.remove(voiceId);
  } catch {
    // Fallback to direct OPFS removal below
  }

  try {
    const originDirectory = await navigator.storage.getDirectory();
    const piperDirectory = await originDirectory.getDirectoryHandle('piper');
    for (const fileName of [`${voiceId}.onnx`, `${voiceId}.onnx.json`]) {
      try {
        await piperDirectory.removeEntry(fileName);
      } catch {
        // Already removed
      }
    }
  } catch {
    // Directory not present
  }
}
