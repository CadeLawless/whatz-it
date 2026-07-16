import { Asset } from 'expo-asset';
import { preload, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import {
  logRoundDiagnostic,
  logVideoDiagnostic,
  warnRoundDiagnostic,
  warnVideoDiagnostic,
} from '@/video/video-diagnostics';

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
for (const [sound, source] of Object.entries(ROUND_SOUND_SOURCES)) {
  void preload(source)
    .then(() => logRoundDiagnostic('native audio preload completed', { sound }))
    .catch((error) => warnRoundDiagnostic('native audio preload failed', error, { sound }));
}

const soundUriPromises = new Map<RoundSoundId, Promise<string>>();
const DEFAULT_ROUND_SOUND_VOLUME = 1;
export const ROUND_VIDEO_SOUND_VOLUME = 0.2;
const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.4,
  flip: 0.7,
  'round-start': 0.65,
};

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadRoundSounds(sounds: RoundSoundId[]) {
  return Promise.all(sounds.map(resolveRoundSoundUri));
}

export async function prepareRoundSoundsForPlayback() {
  if (Platform.OS !== 'ios') return;
  const sounds = Object.keys(ROUND_SOUND_SOURCES) as RoundSoundId[];
  const uris = await preloadRoundSounds(sounds);
  const { prepareSystemSound, supportsSilentAwareSystemSounds } =
    await import('whatz-it-video-export');
  if (!supportsSilentAwareSystemSounds()) return;
  await Promise.all(uris.map(prepareSystemSound));
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
    if (Platform.OS === 'ios') {
      const { playSystemSound, stopSystemSound, supportsSilentAwareSystemSounds } =
        await import('whatz-it-video-export');
      if (supportsSilentAwareSystemSounds()) {
        if (sound === 'round-end') {
          await stopSystemSound(await resolveRoundSoundUri('final-tick'));
        }
        const uri = await resolveRoundSoundUri(sound);
        await playSystemSound(uri);
        logRoundDiagnostic('silent-aware iOS round cue dispatched', {
          sound,
          playbackPath: 'system-ui-sound',
        });
        logVideoDiagnostic('round cue playback started', {
          sound,
          playbackPath: 'system-ui-sound',
        });
        return true;
      }
    }

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
    logVideoDiagnostic('round cue playback started', {
      sound,
      volume,
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
