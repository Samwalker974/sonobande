import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BookSession,
  ChapterItem,
  NeuralVoiceId,
  TransportState,
} from '../types/walkman';
import { parseWavBuffer, processAudioSpeedPitch } from '../utils/audioDsp';

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface CachedSegmentAudio {
  rawBytes: ArrayBuffer;
  mimeType: 'audio/mpeg' | 'audio/wav';
}

interface DecodedPcm {
  samples: Float32Array;
  sampleRate: number;
}

interface UseWalkmanAudioOptions {
  session: BookSession | null;
  activeChapterIndex: number;
  neuralVoiceId: NeuralVoiceId;
  speed: number;
  pitchSemitones: number;
  volume: number;
  muted: boolean;
  onChapterIndexChange: (index: number) => void;
  onBeforePlayChapter?: (chapterIndex: number) => Promise<ChapterItem | null>;
  onError: (message: string) => void;
}

export interface WalkmanAudioController {
  transportState: TransportState;
  activeSegmentIndex: number;
  totalSegmentsInChapter: number;
  segmentCurrentTime: number;
  segmentDuration: number;
  chapterProgressRatio: number;
  vuLevel: number;
  play: (overrideChapterIndex?: number, overrideSegmentIndex?: number) => Promise<void>;
  pause: () => void;
  stop: () => void;
  rewind: () => void;
  fastForward: () => void;
  seekSegment: (seconds: number) => void;
  jumpToSegment: (segmentIndex: number, autoPlay?: boolean) => void;
  jumpToLocation: (chapterIndex: number, segmentIndex: number, autoPlay?: boolean) => void;
  fetchSegmentAudio: (
    chapter: ChapterItem,
    segmentIndex: number,
    signal?: AbortSignal
  ) => Promise<CachedSegmentAudio>;
  decodeAudioToMonoPcm: (audio: CachedSegmentAudio) => Promise<DecodedPcm>;
  clearAudioMemory: () => void;
}

export function useWalkmanAudio({
  session,
  activeChapterIndex,
  neuralVoiceId,
  speed,
  pitchSemitones,
  volume,
  muted,
  onChapterIndexChange,
  onBeforePlayChapter,
  onError,
}: UseWalkmanAudioOptions): WalkmanAudioController {
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0);
  const [segmentCurrentTime, setSegmentCurrentTime] = useState(0);
  const [segmentDuration, setSegmentDuration] = useState(0);
  const [vuLevel, setVuLevel] = useState(0);

  // Ephemeral RAM-only caches for generated audio segments (never persisted)
  const audioCacheRef = useRef<Map<string, CachedSegmentAudio>>(new Map());
  const pcmCacheRef = useRef<WeakMap<ArrayBuffer, DecodedPcm>>(new WeakMap());
  const inflightFetchesRef = useRef<Map<string, Promise<CachedSegmentAudio>>>(new Map());

  // Unified Web Audio API refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const activePcmRef = useRef<DecodedPcm | null>(null);
  const startWallTimeRef = useRef<number>(0);
  const offsetSecondsRef = useRef<number>(0);
  const segmentDurationRef = useRef<number>(0);

  // Lifecycle generation counter to invalidate stale async callbacks cleanly
  const playbackRunIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  const stateRef = useRef<TransportState>('stopped');
  stateRef.current = transportState;

  const currentChapter = session?.chapters[activeChapterIndex] ?? null;
  const totalSegmentsInChapter = currentChapter?.segments.length ?? 0;

  const latestRef = useRef({
    session,
    activeChapterIndex,
    activeSegmentIndex,
    neuralVoiceId,
    speed,
    pitchSemitones,
    volume,
    muted,
    onChapterIndexChange,
    onBeforePlayChapter,
    onError,
  });
  latestRef.current = {
    session,
    activeChapterIndex,
    activeSegmentIndex,
    neuralVoiceId,
    speed,
    pitchSemitones,
    volume,
    muted,
    onChapterIndexChange,
    onBeforePlayChapter,
    onError,
  };

  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;
      gain.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;
      analyserRef.current = analyser;
    }
    return audioCtxRef.current;
  }, []);

  const stopVisualLoops = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const teardownWebAudioSource = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null;
        sourceRef.current.stop();
        sourceRef.current.disconnect();
      } catch {
        // Already stopped
      }
      sourceRef.current = null;
    }
  }, []);

  const stopAllHardware = useCallback(() => {
    playbackRunIdRef.current++;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    teardownWebAudioSource();
    stopVisualLoops();
    setVuLevel(0);
  }, [stopVisualLoops, teardownWebAudioSource]);

  const decodeAudioToMonoPcm = useCallback(
    async (audio: CachedSegmentAudio): Promise<DecodedPcm> => {
      const cached = pcmCacheRef.current.get(audio.rawBytes);
      if (cached) return cached;

      let decoded: DecodedPcm;
      if (audio.mimeType === 'audio/wav') {
        const wav = parseWavBuffer(audio.rawBytes);
        decoded = { samples: wav.samples, sampleRate: wav.sampleRate };
      } else {
        const ctx = ensureAudioContext();
        const audioBuffer = await ctx.decodeAudioData(audio.rawBytes.slice(0));
        const mono = new Float32Array(audioBuffer.length);
        if (audioBuffer.numberOfChannels === 1) {
          mono.set(audioBuffer.getChannelData(0));
        } else {
          const left = audioBuffer.getChannelData(0);
          const right = audioBuffer.getChannelData(1);
          for (let i = 0; i < audioBuffer.length; i++) {
            mono[i] = (left[i] + right[i]) * 0.5;
          }
        }
        decoded = { samples: mono, sampleRate: audioBuffer.sampleRate };
      }

      pcmCacheRef.current.set(audio.rawBytes, decoded);
      return decoded;
    },
    [ensureAudioContext]
  );

  const getCacheKey = useCallback(
    (
      sessionId: string,
      chapterId: string,
      translationStatus: string,
      charCount: number,
      segIdx: number,
      voiceKey: string
    ) => `${sessionId}|${chapterId}|${translationStatus}|${charCount}|${segIdx}|neural|${voiceKey}`,
    []
  );

  const fetchSegmentAudio = useCallback(
    async (
      chapter: ChapterItem,
      segmentIndex: number,
      signal?: AbortSignal
    ): Promise<CachedSegmentAudio> => {
      const {
        session: sess,
        neuralVoiceId: nVoice,
      } = latestRef.current;

      const sessId = sess?.id ?? 'ephemeral';
      const segmentText = chapter.segments[segmentIndex];
      if (!segmentText) {
        throw new Error('Segment audio introuvable.');
      }

      const voiceKey = nVoice;
      const key = getCacheKey(
        sessId,
        chapter.id,
        chapter.translationStatus,
        chapter.charCount,
        segmentIndex,
        voiceKey
      );

      const cached = audioCacheRef.current.get(key);
      if (cached) return cached;

      const inflight = inflightFetchesRef.current.get(key);
      if (inflight) return inflight;

      const reqPromise = (async (): Promise<CachedSegmentAudio> => {
        const response = await fetch('/api/tts-neural', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            text: segmentText,
            voiceName: nVoice,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          audioBase64?: string;
          mimeType?: string;
          error?: string;
        };

        if (!response.ok || !payload.audioBase64) {
          throw new Error(
            payload.error || 'Échec de la synthèse vocale neuronale illimitée.'
          );
        }

        const result: CachedSegmentAudio = {
          rawBytes: base64ToArrayBuffer(payload.audioBase64),
          mimeType: payload.mimeType === 'audio/wav' ? 'audio/wav' : 'audio/mpeg',
        };
        audioCacheRef.current.set(key, result);
        return result;
      })();

      inflightFetchesRef.current.set(key, reqPromise);
      try {
        return await reqPromise;
      } finally {
        inflightFetchesRef.current.delete(key);
      }
    },
    [getCacheKey]
  );

  // Forward declaration via ref so recursive chapter/segment advance works seamlessly
  const startSegmentPlaybackRef = useRef<
    (chapterIndex: number, segmentIndex: number, startOffsetSec?: number) => Promise<void>
  >(async () => {});

  const playPcmBuffer = useCallback(
    async (
      pcm: DecodedPcm,
      chapterIndex: number,
      segmentIndex: number,
      startOffsetSec: number,
      runId: number
    ) => {
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          // Ignore resume error in headless mode
        }
      }
      if (playbackRunIdRef.current !== runId) return;

      const { speed: spd, pitchSemitones: pitch, volume: vol, muted: isMuted } = latestRef.current;
      const shaped = processAudioSpeedPitch(pcm.samples, pcm.sampleRate, spd, pitch);

      const audioBuffer = ctx.createBuffer(1, shaped.length, pcm.sampleRate);
      audioBuffer.copyToChannel(new Float32Array(shaped), 0);

      activePcmRef.current = pcm;
      segmentDurationRef.current = audioBuffer.duration;
      setSegmentDuration(audioBuffer.duration);

      const safeOffset = Math.max(
        0,
        Math.min(startOffsetSec, Math.max(0, audioBuffer.duration - 0.02))
      );
      offsetSecondsRef.current = safeOffset;
      setSegmentCurrentTime(safeOffset);

      teardownWebAudioSource();
      stopVisualLoops();

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      if (gainRef.current) {
        gainRef.current.gain.value = isMuted ? 0 : vol;
        source.connect(gainRef.current);
      } else {
        source.connect(ctx.destination);
      }

      sourceRef.current = source;
      startWallTimeRef.current = ctx.currentTime;
      setTransportState('playing');

      source.onended = () => {
        if (playbackRunIdRef.current !== runId || sourceRef.current !== source) return;
        sourceRef.current = null;
        stopVisualLoops();
        setVuLevel(0);

        const sess = latestRef.current.session;
        if (!sess) {
          setTransportState('stopped');
          return;
        }
        const ch = sess.chapters[chapterIndex];
        if (!ch) {
          setTransportState('stopped');
          return;
        }

        if (segmentIndex + 1 < ch.segments.length) {
          void startSegmentPlaybackRef.current(chapterIndex, segmentIndex + 1, 0);
        } else if (chapterIndex + 1 < sess.chapters.length) {
          latestRef.current.onChapterIndexChange(chapterIndex + 1);
          void startSegmentPlaybackRef.current(chapterIndex + 1, 0, 0);
        } else {
          offsetSecondsRef.current = 0;
          setSegmentCurrentTime(0);
          setTransportState('stopped');
        }
      };

      source.start(0, safeOffset);

      const timeData = new Uint8Array(analyserRef.current?.fftSize ?? 256);
      const tick = () => {
        if (playbackRunIdRef.current !== runId) return;
        const elapsed = ctx.currentTime - startWallTimeRef.current;
        const pos = Math.min(audioBuffer.duration, offsetSecondsRef.current + elapsed);
        setSegmentCurrentTime(pos);

        if (analyserRef.current) {
          analyserRef.current.getByteTimeDomainData(timeData);
          let sumSq = 0;
          for (let i = 0; i < timeData.length; i++) {
            const norm = (timeData[i] - 128) / 128;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / timeData.length);
          setVuLevel(latestRef.current.muted ? 0 : Math.min(1, rms * 3.2));
        }

        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [ensureAudioContext, stopVisualLoops, teardownWebAudioSource]
  );

  const startSegmentPlayback = useCallback(
    async (chapterIndex: number, segmentIndex: number, startOffsetSec = 0) => {
      const sess = latestRef.current.session;
      if (!sess) return;
      let chapter = sess.chapters[chapterIndex];
      if (!chapter) return;

      stopAllHardware();
      const runId = playbackRunIdRef.current;

      // Auto-translate English chapter into French right before playback when active
      if (latestRef.current.onBeforePlayChapter) {
        setTransportState('buffering');
        try {
          const prepared = await latestRef.current.onBeforePlayChapter(chapterIndex);
          if (playbackRunIdRef.current !== runId) return;
          if (!prepared) {
            setTransportState('stopped');
            return;
          }
          chapter = prepared;
        } catch (err) {
          if (playbackRunIdRef.current !== runId) return;
          setTransportState('stopped');
          setVuLevel(0);
          const msg =
            err instanceof Error ? err.message : 'Impossible de traduire ce chapitre en français.';
          latestRef.current.onError(msg);
          return;
        }
      }

      const clampedSegment = Math.max(
        0,
        Math.min(segmentIndex, Math.max(0, chapter.segments.length - 1))
      );
      if (chapter.segments.length === 0) {
        setTransportState('stopped');
        return;
      }

      setActiveSegmentIndex(clampedSegment);
      setTransportState('buffering');
      const ac = new AbortController();
      abortControllerRef.current = ac;

      try {
        const audio = await fetchSegmentAudio(chapter, clampedSegment, ac.signal);
        if (playbackRunIdRef.current !== runId) return;

        // Pre-fetch next segment quietly in the background (1 segment lookahead in RAM)
        if (clampedSegment + 1 < chapter.segments.length) {
          void fetchSegmentAudio(chapter, clampedSegment + 1).catch(() => {
            // Lookahead failure will surface cleanly if/when user reaches that segment
          });
        }

        const pcm = await decodeAudioToMonoPcm(audio);
        if (playbackRunIdRef.current !== runId) return;

        await playPcmBuffer(pcm, chapterIndex, clampedSegment, startOffsetSec, runId);
      } catch (err) {
        if (playbackRunIdRef.current !== runId) return;
        if (err instanceof Error && err.name === 'AbortError') return;

        setTransportState('stopped');
        setVuLevel(0);
        const message = err instanceof Error ? err.message : 'Impossible de lire ce segment audio.';
        latestRef.current.onError(message);
      }
    },
    [decodeAudioToMonoPcm, fetchSegmentAudio, playPcmBuffer, stopAllHardware]
  );

  startSegmentPlaybackRef.current = startSegmentPlayback;

  // Live volume/mute updates
  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = muted ? 0 : volume;
    }
    if (muted) setVuLevel(0);
  }, [volume, muted]);

  // Live speed/pitch reprocessing while playing
  useEffect(() => {
    if (stateRef.current !== 'playing') return;
    if (!activePcmRef.current || !audioCtxRef.current) return;

    const elapsed = audioCtxRef.current.currentTime - startWallTimeRef.current;
    const oldPos = offsetSecondsRef.current + elapsed;
    const oldDur = segmentDurationRef.current || 1;
    const ratio = Math.max(0, Math.min(0.98, oldPos / oldDur));

    const pcm = activePcmRef.current;
    const approxNewDur = (pcm.samples.length / pcm.sampleRate) / Math.max(0.5, speed);
    const nextOffset = ratio * approxNewDur;

    playbackRunIdRef.current++;
    const runId = playbackRunIdRef.current;
    void playPcmBuffer(
      pcm,
      latestRef.current.activeChapterIndex,
      latestRef.current.activeSegmentIndex,
      nextOffset,
      runId
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, pitchSemitones]);

  // Stop cleanly if session changes
  const prevSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextId = session?.id ?? null;
    if (prevSessionIdRef.current !== nextId) {
      prevSessionIdRef.current = nextId;
      stopAllHardware();
      audioCacheRef.current.clear();
      inflightFetchesRef.current.clear();
      activePcmRef.current = null;
      offsetSecondsRef.current = 0;
      setActiveSegmentIndex(0);
      setSegmentCurrentTime(0);
      setSegmentDuration(0);
      setTransportState('stopped');
    }
  }, [session?.id, stopAllHardware]);

  // Restart current segment cleanly when switching voice while playing
  const prevVoiceSignatureRef = useRef<string>(neuralVoiceId);
  useEffect(() => {
    const sig = neuralVoiceId;
    if (prevVoiceSignatureRef.current !== sig) {
      prevVoiceSignatureRef.current = sig;
      const wasPlaying = stateRef.current === 'playing' || stateRef.current === 'buffering';
      stopAllHardware();
      activePcmRef.current = null;
      setTransportState('stopped');
      if (wasPlaying && latestRef.current.session) {
        void startSegmentPlayback(
          latestRef.current.activeChapterIndex,
          latestRef.current.activeSegmentIndex,
          0
        );
      }
    }
  }, [neuralVoiceId, startSegmentPlayback, stopAllHardware]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllHardware();
      audioCacheRef.current.clear();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close();
      }
    };
  }, [stopAllHardware]);

  const play = useCallback(
    async (overrideChapterIndex?: number, overrideSegmentIndex?: number) => {
      const sess = latestRef.current.session;
      if (!sess || sess.chapters.length === 0) return;

      const targetChapter = overrideChapterIndex ?? latestRef.current.activeChapterIndex;
      const targetSegment = overrideSegmentIndex ?? latestRef.current.activeSegmentIndex;

      if (
        overrideChapterIndex === undefined &&
        overrideSegmentIndex === undefined &&
        stateRef.current === 'paused' &&
        activePcmRef.current
      ) {
        playbackRunIdRef.current++;
        const runId = playbackRunIdRef.current;
        await playPcmBuffer(
          activePcmRef.current,
          targetChapter,
          targetSegment,
          offsetSecondsRef.current,
          runId
        );
        return;
      }

      await startSegmentPlayback(targetChapter, targetSegment, 0);
    },
    [playPcmBuffer, startSegmentPlayback]
  );

  const pause = useCallback(() => {
    if (stateRef.current !== 'playing' && stateRef.current !== 'buffering') return;

    if (audioCtxRef.current && sourceRef.current) {
      const elapsed = audioCtxRef.current.currentTime - startWallTimeRef.current;
      offsetSecondsRef.current = Math.min(
        segmentDurationRef.current,
        offsetSecondsRef.current + elapsed
      );
      setSegmentCurrentTime(offsetSecondsRef.current);
    }

    stopAllHardware();
    setTransportState('paused');
  }, [stopAllHardware]);

  const stop = useCallback(() => {
    stopAllHardware();
    offsetSecondsRef.current = 0;
    setSegmentCurrentTime(0);
    setActiveSegmentIndex(0);
    setTransportState('stopped');
  }, [stopAllHardware]);

  const seekSegment = useCallback(
    (seconds: number) => {
      const dur = segmentDurationRef.current;
      const clamped = Math.max(0, Math.min(dur, seconds));
      offsetSecondsRef.current = clamped;
      setSegmentCurrentTime(clamped);

      if (stateRef.current === 'playing' && activePcmRef.current) {
        playbackRunIdRef.current++;
        const runId = playbackRunIdRef.current;
        void playPcmBuffer(
          activePcmRef.current,
          latestRef.current.activeChapterIndex,
          latestRef.current.activeSegmentIndex,
          clamped,
          runId
        );
      }
    },
    [playPcmBuffer]
  );

  const rewind = useCallback(() => {
    if (!latestRef.current.session) return;
    const livePos =
      stateRef.current === 'playing' && audioCtxRef.current
        ? offsetSecondsRef.current + (audioCtxRef.current.currentTime - startWallTimeRef.current)
        : offsetSecondsRef.current;

    if (livePos > 3 || latestRef.current.activeSegmentIndex === 0) {
      seekSegment(Math.max(0, livePos - 5));
    } else {
      void startSegmentPlayback(
        latestRef.current.activeChapterIndex,
        latestRef.current.activeSegmentIndex - 1,
        0
      );
    }
  }, [seekSegment, startSegmentPlayback]);

  const fastForward = useCallback(() => {
    const sess = latestRef.current.session;
    const ch = sess?.chapters[latestRef.current.activeChapterIndex];
    if (!sess || !ch) return;

    const livePos =
      stateRef.current === 'playing' && audioCtxRef.current
        ? offsetSecondsRef.current + (audioCtxRef.current.currentTime - startWallTimeRef.current)
        : offsetSecondsRef.current;
    const dur = segmentDurationRef.current;
    if (dur > 0 && livePos + 5 < dur - 0.5) {
      seekSegment(livePos + 5);
    } else if (latestRef.current.activeSegmentIndex + 1 < ch.segments.length) {
      void startSegmentPlayback(
        latestRef.current.activeChapterIndex,
        latestRef.current.activeSegmentIndex + 1,
        0
      );
    }
  }, [seekSegment, startSegmentPlayback]);

  const jumpToSegment = useCallback(
    (segmentIndex: number, autoPlay = true) => {
      if (!latestRef.current.session) return;
      if (autoPlay) {
        void startSegmentPlayback(latestRef.current.activeChapterIndex, segmentIndex, 0);
      } else {
        stopAllHardware();
        setActiveSegmentIndex(segmentIndex);
        offsetSecondsRef.current = 0;
        setSegmentCurrentTime(0);
        setTransportState('stopped');
      }
    },
    [startSegmentPlayback, stopAllHardware]
  );

  const jumpToLocation = useCallback(
    (chapterIndex: number, segmentIndex: number, autoPlay = false) => {
      const sess = latestRef.current.session;
      if (!sess || chapterIndex < 0 || chapterIndex >= sess.chapters.length) return;
      const ch = sess.chapters[chapterIndex];
      const clampedSeg = Math.max(0, Math.min(segmentIndex, Math.max(0, ch.segments.length - 1)));
      latestRef.current.onChapterIndexChange(chapterIndex);
      if (autoPlay) {
        void startSegmentPlayback(chapterIndex, clampedSeg, 0);
      } else {
        stopAllHardware();
        setActiveSegmentIndex(clampedSeg);
        offsetSecondsRef.current = 0;
        setSegmentCurrentTime(0);
        setTransportState('stopped');
      }
    },
    [startSegmentPlayback, stopAllHardware]
  );

  const clearAudioMemory = useCallback(() => {
    stopAllHardware();
    audioCacheRef.current.clear();
    inflightFetchesRef.current.clear();
    activePcmRef.current = null;
    offsetSecondsRef.current = 0;
    setActiveSegmentIndex(0);
    setSegmentCurrentTime(0);
    setSegmentDuration(0);
    setTransportState('stopped');
  }, [stopAllHardware]);

  const segmentRatio =
    segmentDuration > 0 ? Math.max(0, Math.min(1, segmentCurrentTime / segmentDuration)) : 0;
  const chapterProgressRatio =
    totalSegmentsInChapter > 0
      ? Math.max(0, Math.min(1, (activeSegmentIndex + segmentRatio) / totalSegmentsInChapter))
      : 0;

  return {
    transportState,
    activeSegmentIndex,
    totalSegmentsInChapter,
    segmentCurrentTime,
    segmentDuration,
    chapterProgressRatio,
    vuLevel,
    play,
    pause,
    stop,
    rewind,
    fastForward,
    seekSegment,
    jumpToSegment,
    jumpToLocation,
    fetchSegmentAudio,
    decodeAudioToMonoPcm,
    clearAudioMemory,
  };
}
