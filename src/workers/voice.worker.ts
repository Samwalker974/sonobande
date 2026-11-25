import { HF_BASE, ONNX_BASE, PATH_MAP, WASM_BASE } from '@diffusionstudio/vits-web';
import { createPiperPhonemize } from '@piper-phonemize';
import * as ort from 'onnxruntime-web';
import type { NeuralVoiceId } from '../types/walkman';
import type {
  VoiceSynthesisPhrase,
  VoiceWorkerRequest,
  VoiceWorkerResponse,
} from '../utils/browserVoice';

const MIN_VALID_ONNX_BYTES = 500_000;
const MIN_VALID_JSON_BYTES = 100;

interface PiperVoiceConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  num_symbols?: number;
  phoneme_id_map?: Record<string, number[]>;
  speaker_id_map?: Record<string, number>;
}

interface LoadedVoiceRuntime {
  voiceId: NeuralVoiceId;
  config: PiperVoiceConfig;
  session: ort.InferenceSession;
}

interface PhonemizerAssets {
  wasmBinary: ArrayBuffer;
  dataBuffer: ArrayBuffer;
}

const workerScope = self as unknown as {
  postMessage: (message: VoiceWorkerResponse, transfer?: Transferable[]) => void;
};

const validatedVoices = new Set<NeuralVoiceId>();
let activeVoiceRuntime: LoadedVoiceRuntime | null = null;
let loadingVoicePromise: Promise<LoadedVoiceRuntime> | null = null;
let loadingVoiceId: NeuralVoiceId | null = null;

let phonemizerAssetsPromise: Promise<PhonemizerAssets> | null = null;
let ortConfigured = false;

let synthesisQueue: Promise<void> = Promise.resolve();
const cancelledRequestIds = new Set<number>();

function sendMessage(message: VoiceWorkerResponse, transfer: Transferable[] = []): void {
  if (transfer.length > 0) {
    workerScope.postMessage(message, transfer);
  } else {
    workerScope.postMessage(message);
  }
}

function getOptimalWasmThreads(): number {
  const isolated =
    typeof self !== 'undefined' &&
    Boolean(self.crossOriginIsolated) &&
    typeof SharedArrayBuffer === 'function';
  if (!isolated) return 1;
  const cores = self.navigator?.hardwareConcurrency ?? 2;
  // Cap at 2 threads so background lookahead synthesis never starves Web Audio playback
  return Math.max(1, Math.min(2, Math.floor(cores / 2)));
}

function configureOrt(numThreads: number): void {
  ort.env.wasm.wasmPaths = ONNX_BASE;
  ort.env.wasm.simd = true;
  ort.env.wasm.numThreads = numThreads;
  ortConfigured = true;
}

function formatVoiceError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return `Impossible de générer la voix dans le navigateur (${error.trim()}).`;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const msg = String((error as { message?: unknown }).message ?? '').trim();
    if (msg) {
      return `Impossible de générer la voix dans le navigateur (${msg}).`;
    }
  }
  if (typeof error === 'number') {
    return `Impossible de générer la voix dans le navigateur (erreur WASM ${error}).`;
  }
  return 'Impossible de générer la voix dans le navigateur.';
}

async function purgeCorruptedCachedVoiceOnce(voiceId: NeuralVoiceId): Promise<void> {
  if (validatedVoices.has(voiceId)) return;
  if (!self.navigator?.storage?.getDirectory) {
    validatedVoices.add(voiceId);
    return;
  }

  try {
    const root = await self.navigator.storage.getDirectory();
    const piperDir = await root.getDirectoryHandle('piper');

    try {
      const onnxHandle = await piperDir.getFileHandle(`${voiceId}.onnx`);
      const onnxFile = await onnxHandle.getFile();
      if (onnxFile.size < MIN_VALID_ONNX_BYTES) {
        await piperDir.removeEntry(`${voiceId}.onnx`);
      }
    } catch {
      // File not cached yet
    }

    try {
      const jsonHandle = await piperDir.getFileHandle(`${voiceId}.onnx.json`);
      const jsonFile = await jsonHandle.getFile();
      if (jsonFile.size < MIN_VALID_JSON_BYTES) {
        await piperDir.removeEntry(`${voiceId}.onnx.json`);
      } else {
        JSON.parse(await jsonFile.text());
      }
    } catch {
      try {
        await piperDir.removeEntry(`${voiceId}.onnx.json`);
      } catch {
        // File not cached yet
      }
    }
  } catch {
    // piper directory not created yet
  }

  validatedVoices.add(voiceId);
}

async function readOpfsPiperFile(fileName: string): Promise<File | null> {
  if (!self.navigator?.storage?.getDirectory) return null;
  try {
    const root = await self.navigator.storage.getDirectory();
    const piperDir = await root.getDirectoryHandle('piper', { create: true });
    const handle = await piperDir.getFileHandle(fileName);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function writeOpfsPiperFile(fileName: string, data: Blob): Promise<void> {
  if (!self.navigator?.storage?.getDirectory) return;
  try {
    const root = await self.navigator.storage.getDirectory();
    const piperDir = await root.getDirectoryHandle('piper', { create: true });
    const handle = await piperDir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  } catch {
    // OPFS write is best-effort cache; inference still works from RAM
  }
}

async function loadVoiceFileBlob(url: string): Promise<Blob> {
  const fileName = url.split('/').at(-1) ?? '';
  if (fileName) {
    const cached = await readOpfsPiperFile(fileName);
    if (cached) return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Impossible de télécharger le modèle vocal (${response.status}).`);
  }
  const blob = await response.blob();
  if (fileName) {
    await writeOpfsPiperFile(fileName, blob);
  }
  return blob;
}

async function createOnnxSessionWithFallback(modelBytes: Uint8Array): Promise<ort.InferenceSession> {
  const desiredThreads = getOptimalWasmThreads();
  if (!ortConfigured) {
    configureOrt(desiredThreads);
  }

  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: ['wasm'],
  };

  try {
    return await ort.InferenceSession.create(modelBytes, sessionOptions);
  } catch (error) {
    if ((ort.env.wasm.numThreads ?? 1) > 1) {
      configureOrt(1);
      return ort.InferenceSession.create(modelBytes, sessionOptions);
    }
    throw error;
  }
}

async function getVoiceRuntime(voiceId: NeuralVoiceId): Promise<LoadedVoiceRuntime> {
  if (activeVoiceRuntime && activeVoiceRuntime.voiceId === voiceId) {
    return activeVoiceRuntime;
  }

  if (loadingVoicePromise && loadingVoiceId === voiceId) {
    return loadingVoicePromise;
  }

  loadingVoiceId = voiceId;
  loadingVoicePromise = (async (): Promise<LoadedVoiceRuntime> => {
    await purgeCorruptedCachedVoiceOnce(voiceId);

    const modelRelPath = PATH_MAP[voiceId];
    if (!modelRelPath) {
      throw new Error(`Modèle vocal inconnu : ${voiceId}`);
    }

    const [jsonBlob, onnxBlob] = await Promise.all([
      loadVoiceFileBlob(`${HF_BASE}/${modelRelPath}.json`),
      loadVoiceFileBlob(`${HF_BASE}/${modelRelPath}`),
    ]);

    const config = JSON.parse(await jsonBlob.text()) as PiperVoiceConfig;
    const modelBytes = new Uint8Array(await onnxBlob.arrayBuffer());

    // Release previous voice session cleanly before allocating the new one
    if (activeVoiceRuntime) {
      const previous = activeVoiceRuntime;
      activeVoiceRuntime = null;
      try {
        await previous.session.release();
      } catch {
        // Ignore release error on previous session
      }
    }

    const session = await createOnnxSessionWithFallback(modelBytes);
    const runtime: LoadedVoiceRuntime = { voiceId, config, session };
    activeVoiceRuntime = runtime;
    return runtime;
  })().finally(() => {
    if (loadingVoiceId === voiceId) {
      loadingVoicePromise = null;
      loadingVoiceId = null;
    }
  });

  return loadingVoicePromise;
}

async function getPhonemizerAssets(): Promise<PhonemizerAssets> {
  if (!phonemizerAssetsPromise) {
    phonemizerAssetsPromise = Promise.all([
      fetch(`${WASM_BASE}.wasm`).then(async (res) => {
        if (!res.ok) throw new Error(`Impossible de charger piper_phonemize.wasm (${res.status}).`);
        return res.arrayBuffer();
      }),
      fetch(`${WASM_BASE}.data`).then(async (res) => {
        if (!res.ok) throw new Error(`Impossible de charger piper_phonemize.data (${res.status}).`);
        return res.arrayBuffer();
      }),
    ])
      .then(([wasmBinary, dataBuffer]) => ({ wasmBinary, dataBuffer }))
      .catch((error: unknown) => {
        phonemizerAssetsPromise = null;
        throw error;
      });
  }
  return phonemizerAssetsPromise;
}

function mapPhonemesWithVoiceConfig(
  phonemes: readonly string[],
  phonemeIdMap: Record<string, number[]> | undefined
): number[] | null {
  if (!phonemeIdMap) return null;
  const bos = phonemeIdMap['^'];
  const pad = phonemeIdMap['_'];
  const eos = phonemeIdMap['$'];
  if (!bos || !pad || !eos) return null;

  const ids: number[] = [...bos, ...pad];
  let mappedCount = 0;
  for (const phoneme of phonemes) {
    const direct = phonemeIdMap[phoneme];
    if (direct && direct.length > 0) {
      ids.push(...direct, ...pad);
      mappedCount++;
      continue;
    }
    // Split multi-codepoint IPA clusters (e.g. nasal vowels in NFD) per Piper spec
    for (const cp of Array.from(phoneme.normalize('NFD'))) {
      const mapped = phonemeIdMap[cp];
      if (mapped && mapped.length > 0) {
        ids.push(...mapped, ...pad);
        mappedCount++;
      }
    }
  }
  if (mappedCount === 0) return null;
  ids.push(...eos);
  return ids;
}

async function phonemizeSingleText(
  assets: PhonemizerAssets,
  config: PiperVoiceConfig,
  text: string
): Promise<number[]> {
  const inputJson = JSON.stringify([{ text: text.trim() }]);
  let phonemeIds: number[] | null = null;
  const errors: string[] = [];

  // Always create a fresh Emscripten piper_phonemize instance per call from the in-RAM cached
  // wasmBinary + dataBuffer: piper_phonemize is a CLI main() with espeak-ng global state that
  // corrupts phoneme_ids if callMain() is invoked more than once on the same module instance.
  const module = await createPiperPhonemize({
    wasmBinary: assets.wasmBinary.slice(0),
    getPreloadedPackage: () => assets.dataBuffer.slice(0),
    print: (line: string) => {
      if (phonemeIds !== null) return;
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const parsed = JSON.parse(trimmed) as {
          phonemes?: string[];
          phoneme_ids?: number[];
        };
        const maxSymbol = typeof config.num_symbols === 'number' ? config.num_symbols : Infinity;
        if (
          Array.isArray(parsed.phoneme_ids) &&
          parsed.phoneme_ids.length > 0 &&
          parsed.phoneme_ids.every((id) => Number.isInteger(id) && id >= 0 && id < maxSymbol)
        ) {
          phonemeIds = parsed.phoneme_ids;
          return;
        }
        if (Array.isArray(parsed.phonemes) && parsed.phonemes.length > 0) {
          const customMapped = mapPhonemesWithVoiceConfig(parsed.phonemes, config.phoneme_id_map);
          if (customMapped) {
            phonemeIds = customMapped;
            return;
          }
        }
        if (Array.isArray(parsed.phoneme_ids)) {
          phonemeIds = parsed.phoneme_ids.filter(
            (id) => Number.isInteger(id) && id >= 0 && id < maxSymbol
          );
        }
      } catch {
        // Ignore non-JSON diagnostic lines
      }
    },
    printErr: (line: string) => {
      const trimmed = line.trim();
      if (trimmed) errors.push(trimmed);
    },
    locateFile: (file: string) =>
      file.endsWith('.wasm')
        ? `${WASM_BASE}.wasm`
        : file.endsWith('.data')
          ? `${WASM_BASE}.data`
          : file,
  });

  module.callMain([
    '-l',
    config.espeak.voice,
    '--input',
    inputJson,
    '--espeak_data',
    '/espeak-ng-data',
  ]);

  if (phonemeIds === null) {
    if (errors.length > 0) {
      throw new Error(errors.join(' '));
    }
    return [];
  }

  return phonemeIds;
}

async function phonemizeBatch(config: PiperVoiceConfig, texts: string[]): Promise<number[][]> {
  const assets = await getPhonemizerAssets();
  const results: number[][] = [];
  for (const text of texts) {
    results.push(await phonemizeSingleText(assets, config, text));
  }
  return results;
}

async function runOnnxInference(
  runtime: LoadedVoiceRuntime,
  phonemeIds: number[]
): Promise<Float32Array> {
  if (phonemeIds.length === 0) {
    return new Float32Array(0);
  }

  const { config, session } = runtime;
  const inputTensor = new ort.Tensor(
    'int64',
    BigInt64Array.from(phonemeIds, (id) => BigInt(id)),
    [1, phonemeIds.length]
  );
  const inputLengthsTensor = new ort.Tensor(
    'int64',
    new BigInt64Array([BigInt(phonemeIds.length)]),
    [1]
  );
  const scalesTensor = new ort.Tensor(
    'float32',
    new Float32Array([
      config.inference.noise_scale,
      config.inference.length_scale,
      config.inference.noise_w,
    ]),
    [3]
  );

  const feeds: Record<string, ort.Tensor> = {
    input: inputTensor,
    input_lengths: inputLengthsTensor,
    scales: scalesTensor,
  };

  let sidTensor: ort.Tensor | null = null;
  if (config.speaker_id_map && Object.keys(config.speaker_id_map).length > 0) {
    sidTensor = new ort.Tensor('int64', new BigInt64Array([0n]), [1]);
    feeds.sid = sidTensor;
  }

  let outputs: ort.InferenceSession.OnnxValueMapType | null = null;
  try {
    outputs = await session.run(feeds);
    const rawOutput = outputs.output?.data;
    if (!(rawOutput instanceof Float32Array)) {
      throw new Error('Sortie audio ONNX invalide.');
    }
    // Copy out of the ONNX WASM heap and sanitize/clamp [-1, 1] before disposing the output tensor
    const copied = new Float32Array(rawOutput.length);
    for (let i = 0; i < rawOutput.length; i++) {
      const s = rawOutput[i];
      copied[i] = Number.isFinite(s) ? (s > 1 ? 1 : s < -1 ? -1 : s) : 0;
    }
    return copied;
  } finally {
    inputTensor.dispose();
    inputLengthsTensor.dispose();
    scalesTensor.dispose();
    sidTensor?.dispose();
    if (outputs) {
      for (const tensor of Object.values(outputs)) {
        if (tensor && typeof (tensor as ort.Tensor).dispose === 'function') {
          (tensor as ort.Tensor).dispose();
        }
      }
    }
  }
}

async function synthesizeRequest(
  request: Extract<VoiceWorkerRequest, { type: 'synthesize' }>
): Promise<{ samples: Float32Array; sampleRate: number; pauseOffsets: number[] } | null> {
  const phrases: VoiceSynthesisPhrase[] =
    request.phrases && request.phrases.length > 0
      ? request.phrases.filter((p) => p.text.trim().length > 0)
      : [{ text: request.text.trim(), pauseAfter: false }].filter((p) => p.text.length > 0);

  if (phrases.length === 0) {
    return { samples: new Float32Array(0), sampleRate: 22050, pauseOffsets: [] };
  }

  // Load ONNX model & phonemizer binaries in parallel on cold start
  const [runtime] = await Promise.all([getVoiceRuntime(request.voiceId), getPhonemizerAssets()]);
  if (cancelledRequestIds.has(request.id)) return null;

  const totalPhrases = phrases.length;
  if (totalPhrases > 1) {
    sendMessage({ type: 'progress', id: request.id, completed: 0, total: totalPhrases });
  }

  const phonemeBatches = await phonemizeBatch(
    runtime.config,
    phrases.map((p) => p.text)
  );
  if (cancelledRequestIds.has(request.id)) return null;

  const sampleRate = runtime.config.audio.sample_rate;
  const microFadeSamples = Math.round(sampleRate * 0.006);
  const naturalGapSamples = Math.round(sampleRate * 0.045);

  const phraseSamples: Float32Array[] = [];
  let totalSamples = 0;

  for (let idx = 0; idx < phrases.length; idx++) {
    if (cancelledRequestIds.has(request.id)) return null;

    const pcm = await runOnnxInference(runtime, phonemeBatches[idx] ?? []);
    // Gentle 6 ms micro-fade at sentence boundaries to eliminate splice clicks/artifacts
    const fadeLen = Math.min(microFadeSamples, Math.floor(pcm.length / 4));
    for (let i = 0; i < fadeLen; i++) {
      const ramp = i / Math.max(1, fadeLen);
      pcm[i] *= ramp;
      pcm[pcm.length - 1 - i] *= ramp;
    }

    phraseSamples.push(pcm);
    totalSamples += pcm.length;

    if (totalPhrases > 1) {
      sendMessage({
        type: 'progress',
        id: request.id,
        completed: idx + 1,
        total: totalPhrases,
      });
    }
  }

  if (cancelledRequestIds.has(request.id)) return null;

  if (phraseSamples.length === 1) {
    const single = phraseSamples[0];
    const pauseOffsets = phrases[0]?.pauseAfter ? [single.length] : [];
    return { samples: single, sampleRate, pauseOffsets };
  }

  const totalGapSamples = naturalGapSamples * (phraseSamples.length - 1);
  const combined = new Float32Array(totalSamples + totalGapSamples);
  const pauseOffsets: number[] = [];
  let offset = 0;
  for (let idx = 0; idx < phraseSamples.length; idx++) {
    const chunk = phraseSamples[idx];
    combined.set(chunk, offset);
    offset += chunk.length;
    if (phrases[idx]?.pauseAfter) {
      pauseOffsets.push(offset);
    }
    if (idx < phraseSamples.length - 1) {
      offset += naturalGapSamples;
    }
  }

  return { samples: combined, sampleRate, pauseOffsets };
}

self.addEventListener('message', (event: MessageEvent<VoiceWorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelledRequestIds.add(request.id);
    return;
  }

  synthesisQueue = synthesisQueue.then(async () => {
    try {
      if (cancelledRequestIds.has(request.id)) return;

      const result = await synthesizeRequest(request);
      if (result && !cancelledRequestIds.has(request.id)) {
        const pcmBuffer = result.samples.buffer as ArrayBuffer;
        sendMessage(
          {
            type: 'result',
            id: request.id,
            pcmBuffer,
            sampleRate: result.sampleRate,
            pauseOffsets: result.pauseOffsets,
          },
          [pcmBuffer]
        );
      }
    } catch (error) {
      if (!cancelledRequestIds.has(request.id)) {
        sendMessage({
          type: 'error',
          id: request.id,
          message: formatVoiceError(error),
        });
      }
    } finally {
      cancelledRequestIds.delete(request.id);
    }
  });
});
