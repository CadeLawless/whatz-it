import { preload, type AudioPlayer } from 'expo-audio';
import { RoundSoundPlayback } from './round-sound-playback';

import {
  logRoundDiagnostic,
  logVideoDiagnostic,
  warnRoundDiagnostic,
  warnVideoDiagnostic,
} from '@/video/video-diagnostics';
import {
  CRITICAL_ROUND_SOUNDS,
  type RoundSoundId,
} from '@/video/round-sound-plan';

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

// Prioritize the three intro resources with Expo's module-scope preload cache.
// Gameplay players use source-at-construction, avoiding the fragile native
// null-player replacement path while the intro receives the earliest warmup.
const criticalPreloadPromise = preloadUniqueRoundSounds(CRITICAL_ROUND_SOUNDS);

const DEFAULT_ROUND_SOUND_VOLUME = 1;
const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.4,
  flip: 0.7,
  'round-start': 0.65,
  'final-tick': 0.8,
};
const playback = new RoundSoundPlayback();

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadCriticalRoundSounds() {
  return criticalPreloadPromise;
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId, isCurrent?: () => boolean) {
  try {
    const volume = ROUND_SOUND_VOLUMES[sound] ?? DEFAULT_ROUND_SOUND_VOLUME;
    if (!await playback.play(player, volume, isCurrent)) return false;
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

async function preloadUniqueRoundSounds(sounds: readonly RoundSoundId[]) {
  const entries = [...new Map(sounds.map((sound) => [ROUND_SOUND_SOURCES[sound], sound])).entries()];
  await Promise.all(
    entries.map(async ([source, sound]) => {
      try {
        await preload(source);
        logRoundDiagnostic('native audio preload completed', { sound });
      } catch (error) {
        warnRoundDiagnostic('native audio preload failed', error, { sound });
      }
    }),
  );
}
