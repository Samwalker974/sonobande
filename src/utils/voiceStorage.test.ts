import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearVoiceHealthEntry,
  DEFAULT_VOICE_LISTENING_SETTINGS,
  readTuningPanelOpen,
  readVoiceHealthMap,
  readVoiceListeningSettings,
  writeTuningPanelOpen,
  writeVoiceHealthEntry,
  writeVoiceListeningSettings,
} from './voiceStorage';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

test('readVoiceListeningSettings returns defaults when storage is empty', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(readVoiceListeningSettings(storage), DEFAULT_VOICE_LISTENING_SETTINGS);
});

test('writeVoiceListeningSettings and readVoiceListeningSettings round-trip all voice settings', () => {
  const storage = createMemoryStorage();
  writeVoiceListeningSettings(
    {
      voiceId: 'fr_FR-tom-medium',
      speed: 1.25,
      pitchSemitones: -1.5,
      pauseDurationSeconds: 0.4,
      hdVoiceEnhanced: false,
      volume: 0.65,
      muted: true,
      autoTranslateToFrench: false,
    },
    storage
  );

  assert.deepEqual(readVoiceListeningSettings(storage), {
    voiceId: 'fr_FR-tom-medium',
    speed: 1.25,
    pitchSemitones: -1.5,
    pauseDurationSeconds: 0.4,
    hdVoiceEnhanced: false,
    volume: 0.65,
    muted: true,
    autoTranslateToFrench: false,
  });
});

test('readVoiceListeningSettings migrates legacy selected-voice and hd-voice keys', () => {
  const storage = createMemoryStorage();
  storage.setItem('sonobande:selected-voice', 'fr_FR-upmc-medium');
  storage.setItem('sonobande:hd-voice-enhanced', 'false');

  const restored = readVoiceListeningSettings(storage);
  assert.equal(restored.voiceId, 'fr_FR-upmc-medium');
  assert.equal(restored.hdVoiceEnhanced, false);
  assert.equal(restored.speed, DEFAULT_VOICE_LISTENING_SETTINGS.speed);
});

test('readVoiceListeningSettings clamps out-of-range and invalid stored values safely', () => {
  const storage = createMemoryStorage();
  storage.setItem(
    'sonobande:voice-settings:v1',
    JSON.stringify({
      voiceId: 'fr_FR-gilles-low', // removed incompatible voice
      speed: 9.9,
      pitchSemitones: -99,
      pauseDurationSeconds: -5,
      hdVoiceEnhanced: true,
      volume: 4,
      muted: false,
      autoTranslateToFrench: true,
    })
  );

  const restored = readVoiceListeningSettings(storage);
  assert.equal(restored.voiceId, DEFAULT_VOICE_LISTENING_SETTINGS.voiceId);
  assert.equal(restored.speed, 2.0);
  assert.equal(restored.pitchSemitones, -6);
  assert.equal(restored.pauseDurationSeconds, 0);
  assert.equal(restored.volume, 1);
});

test('voice health entries and tuning panel open preference persist cleanly', () => {
  const storage = createMemoryStorage();
  writeVoiceHealthEntry('fr_FR-siwis-medium', 'working', null, storage);
  writeVoiceHealthEntry('fr_FR-mls-medium', 'failed', 'Erreur ONNX', storage);

  const health = readVoiceHealthMap(storage);
  assert.equal(health['fr_FR-siwis-medium']?.state, 'working');
  assert.equal(health['fr_FR-mls-medium']?.state, 'failed');
  assert.equal(health['fr_FR-mls-medium']?.errorMessage, 'Erreur ONNX');

  clearVoiceHealthEntry('fr_FR-mls-medium', storage);
  assert.equal(readVoiceHealthMap(storage)['fr_FR-mls-medium'], undefined);

  assert.equal(readTuningPanelOpen(storage), false);
  writeTuningPanelOpen(true, storage);
  assert.equal(readTuningPanelOpen(storage), true);
});
