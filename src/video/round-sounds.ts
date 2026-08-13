import { preload, type AudioPlayer } from 'expo-audio';

import {
  logRoundDiagnostic,
  logVideoDiagnostic,
  warnRoundDiagnostic,
  warnVideoDiagnostic,
} from '@/video/video-diagnostics';
import {
  CRITICAL_ROUND_SOUNDS,
  GAMEPLAY_ROUND_SOUNDS,
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

// Prioritize only the three intro resources at module load. The gameplay bank
// begins after these are warm, spreading native decoder setup across app idle
// time instead of initializing every player at once.
const criticalPreloadPromise = preloadUniqueRoundSounds(CRITICAL_ROUND_SOUNDS);
let gameplayPreloadPromise: Promise<void> | null = null;

const DEFAULT_ROUND_SOUND_VOLUME = 1;
const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.4,
  flip: 0.7,
  'round-start': 0.65,
  'final-tick': 0.8,
};

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadCriticalRoundSounds() {
  return criticalPreloadPromise;
}

export function preloadGameplayRoundSounds() {
  if (!gameplayPreloadPromise) {
    gameplayPreloadPromise = preloadUniqueRoundSounds(GAMEPLAY_ROUND_SOUNDS);
  }
  return gameplayPreloadPromise;
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId) {
  logRoundDiagnostic('audio playback function entered', {
    sound,
    currentTime: player.currentTime,
    duration: player.duration,
    isBuffering: player.isBuffering,
    isLoaded: player.isLoaded,
    paused: player.paused,
    playing: player.playing,
  });
  if (!player.isLoaded) {
    warnVideoDiagnostic('round cue skipped because its player is not loaded', undefined, { sound });
    return false;
  }

  try {
    const volume = ROUND_SOUND_VOLUMES[sound] ?? DEFAULT_ROUND_SOUND_VOLUME;
    if (player.playing) player.pause();
    if (player.currentTime > 0.005) {
      const seekStartedAt = Date.now();
      logRoundDiagnostic('audio cue rewind started', { sound, from: player.currentTime });
      await player.seekTo(0);
      logRoundDiagnostic('audio cue rewind completed', {
        sound,
        elapsedMs: Date.now() - seekStartedAt,
        currentTime: player.currentTime,
      });
    }
    if (!player.isLoaded) return false;
    player.volume = volume;
    player.play();
    logRoundDiagnostic('native audio play invoked', {
      sound,
      volume,
      currentTime: player.currentTime,
      duration: player.duration,
      playing: player.playing,
    });
    logVideoDiagnostic('round cue playback started', { sound, volume });
    return true;
  } catch (error) {
    warnVideoDiagnostic('round cue playback failed', error, { sound });
    // A cue should never interrupt the round if the device cannot play it.
    return false;
  }
}

export async function rewindRoundSoundPlayer(player: AudioPlayer) {
  if (!player.isLoaded) return false;
  try {
    if (player.playing) player.pause();
    if (player.currentTime > 0.005) await player.seekTo(0);
    return player.isLoaded;
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
