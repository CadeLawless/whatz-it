import { Asset } from 'expo-asset';
import { preload, type AudioPlayer } from 'expo-audio';

import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

export type RoundSoundId =
  | 'get-ready'
  | 'count-3'
  | 'count-2'
  | 'count-1'
  | 'round-start'
  | 'final-tick'
  | 'correct'
  | 'pass'
  | 'flip'
  | 'round-end';

export type RoundVideoSoundCue = {
  atMs: number;
  sound: RoundSoundId;
};

const ROUND_SOUND_SOURCES: Record<RoundSoundId, number> = {
  'get-ready': require('../../assets/sounds/get-ready.wav'),
  'count-3': require('../../assets/sounds/count-3.wav'),
  'count-2': require('../../assets/sounds/count-2.wav'),
  'count-1': require('../../assets/sounds/count-1.wav'),
  'round-start': require('../../assets/sounds/round-start.wav'),
  'final-tick': require('../../assets/sounds/final-tick.wav'),
  correct: require('../../assets/sounds/correct.wav'),
  pass: require('../../assets/sounds/pass.wav'),
  flip: require('../../assets/sounds/flip.wav'),
  'round-end': require('../../assets/sounds/round-end.wav'),
};

// Begin native decoder/buffer preparation as soon as the app bundle loads.
// The persistent sound provider still verifies that every player is loaded
// before allowing a round to begin.
for (const source of Object.values(ROUND_SOUND_SOURCES)) preload(source);

const soundUriPromises = new Map<RoundSoundId, Promise<string>>();
const ROUND_SOUND_VOLUME = 1;

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadRoundSounds(sounds: RoundSoundId[]) {
  return Promise.all(sounds.map(resolveRoundSoundUri));
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId) {
  if (!player.isLoaded) {
    warnVideoDiagnostic('round cue skipped because its player is not loaded', undefined, { sound });
    return false;
  }

  try {
    if (player.playing) player.pause();
    if (player.currentTime > 0.005) await player.seekTo(0);
    if (!player.isLoaded) return false;
    player.volume = ROUND_SOUND_VOLUME;
    player.play();
    logVideoDiagnostic('round cue playback started', {
      sound,
      volume: ROUND_SOUND_VOLUME,
    });
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

export async function resolveRoundAudioCues(cues: RoundVideoSoundCue[]) {
  return Promise.all(
    cues.map(async (cue) => ({
      atMs: cue.atMs,
      uri: await resolveRoundSoundUri(cue.sound),
    })),
  );
}

async function resolveRoundSoundUri(sound: RoundSoundId) {
  const cached = soundUriPromises.get(sound);
  if (cached) return cached;

  const loading = (async () => {
    const [asset] = await Asset.loadAsync(ROUND_SOUND_SOURCES[sound]);
    if (!asset.localUri) throw new Error(`The ${sound} sound is unavailable on this device.`);
    return asset.localUri;
  })();
  soundUriPromises.set(sound, loading);
  try {
    return await loading;
  } catch (error) {
    soundUriPromises.delete(sound);
    throw error;
  }
}
