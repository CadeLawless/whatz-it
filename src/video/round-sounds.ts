import { Asset } from 'expo-asset';
import type { AudioPlayer } from 'expo-audio';

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
  'round-end': require('../../assets/sounds/round-end.wav'),
};

const soundUriPromises = new Map<RoundSoundId, Promise<string>>();
const ROUND_SOUND_VOLUME = 0.3;

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadRoundSounds(sounds: RoundSoundId[]) {
  return Promise.all(sounds.map(resolveRoundSoundUri));
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId) {
  try {
    await player.seekTo(0);
    player.volume = ROUND_SOUND_VOLUME;
    player.play();
    logVideoDiagnostic('round cue playback started', {
      sound,
      volume: ROUND_SOUND_VOLUME,
    });
  } catch (error) {
    warnVideoDiagnostic('round cue playback failed', error, { sound });
    // A cue should never interrupt the round if the device cannot play it.
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
