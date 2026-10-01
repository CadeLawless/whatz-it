import { traceAndroidGameplay } from '@/utils/android-gameplay-trace';
import { Asset } from 'expo-asset';
import type { AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import { prepareAndroidRoundSounds, playAndroidRoundSound, supportsAndroidRoundSounds } from 'whatz-it-video-export';
import { RoundSoundPlayback, type CuePlayer } from './round-sound-playback';

import type { RoundSoundId } from '@/video/round-sound-plan';
import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

export type { RoundSoundId } from '@/video/round-sound-plan';

const ROUND_SOUND_SOURCES: Record<RoundSoundId, number> = {
  'get-ready': require('../../assets/sounds/get-ready.wav'),
  'count-3': require('../../assets/sounds/count-3.wav'),
  'count-2': require('../../assets/sounds/count-3.wav'),
  'count-1': require('../../assets/sounds/count-3.wav'),
  'round-start': require('../../assets/sounds/round-start.wav'),
  'final-tick': require('../../assets/sounds/final-tick.wav'),
  correct: require('../../assets/sounds/correct.wav'),
  pass: require('../../assets/sounds/pass.wav'),
  flip: require('../../assets/sounds/flip.wav'),
  'round-end': require('../../assets/sounds/round-end.wav'),
};

const ANDROID_ANSWER_SOUND_SOURCES: Partial<Record<RoundSoundId, number>> = {
  correct: require('../../assets/sounds/android/correct.wav'),
  pass: require('../../assets/sounds/android/pass.wav'),
  flip: require('../../assets/sounds/android/flip.wav'),
};

const DEFAULT_ROUND_SOUND_VOLUME = 1;
const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.3,
  pass: 0.8,
  flip: 0.65,
  'round-start': 0.7,
  'final-tick': 0.65
};
const playback = new RoundSoundPlayback();
let androidSoundsReady = false;
let androidPreparation: Promise<boolean> | null = null;

export function isAndroidRoundSoundBankReady() {
  return Platform.OS === 'android' && androidSoundsReady;
}

export function prepareAndroidRoundSoundBank(): Promise<boolean> {
  if (Platform.OS !== 'android' || !supportsAndroidRoundSounds()) return Promise.resolve(false);
  if (androidSoundsReady) return Promise.resolve(true);
  return androidPreparation ??= (async () => {
    try {
      const sources = await Promise.all(Object.entries(ROUND_SOUND_SOURCES).map(async ([sound, source]) => {
        const asset = await Asset.fromModule(ANDROID_ANSWER_SOUND_SOURCES[sound as RoundSoundId] ?? source).downloadAsync();
        if (!asset.localUri) throw new Error(`Round sound unavailable: ${sound}`);
        return [sound, asset.localUri] as const;
      }));
      androidSoundsReady = await prepareAndroidRoundSounds(Object.fromEntries(sources));
      logVideoDiagnostic('Android short-sound bank prepared', { ready: androidSoundsReady });
      return androidSoundsReady;
    } catch (error) {
      warnVideoDiagnostic('Android short-sound preparation failed', error);
      return false;
    } finally {
      androidPreparation = null;
    }
  })();
}

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export async function playRoundSound(player: CuePlayer, sound: RoundSoundId, isCurrent?: () => boolean) {
  traceAndroidGameplay('audio.request', { sound });
  try {
    const volume = ROUND_SOUND_VOLUMES[sound] ?? DEFAULT_ROUND_SOUND_VOLUME;
    if (isAndroidRoundSoundBankReady()) {
      if (isCurrent && !isCurrent()) return false;
      const played = playAndroidRoundSound(sound, volume);
      traceAndroidGameplay('audio.play-returned', { sound, path: 'sound-pool', played });
      return played;
    }
    if (!await playback.play(player, volume, isCurrent)) return false;
    traceAndroidGameplay('audio.play-returned', { sound });
    logVideoDiagnostic('round cue playback started', { sound, volume });
    return true;
  } catch (error) {
    warnVideoDiagnostic('round cue playback failed', error, { sound });
    // A cue should never interrupt the round if the device cannot play it.
    return false;
  }
}

export function stopRoundSoundPlayer(player: AudioPlayer) {
  try {
    playback.stop(player);
  } catch {
    // Hook-owned players may already have been released during root teardown.
  }
}

export async function rewindRoundSoundPlayer(player: AudioPlayer, sound: RoundSoundId) {
  try {
    return await playback.prepare(player, ROUND_SOUND_VOLUMES[sound] ?? DEFAULT_ROUND_SOUND_VOLUME);
  } catch {
    return false;
  }
}
