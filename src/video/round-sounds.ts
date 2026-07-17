import { Asset } from 'expo-asset';
import { preload, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import { shouldSuppressLiveRoundSound } from '@/video/silent-switch-policy';
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

type SilentSwitchListener = (silentSwitchOn: boolean) => void;

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
const SILENT_SWITCH_PROBE_INTERVAL_MS = 80;
const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.4,
  flip: 0.7,
  'round-start': 0.65,
};
let silentSwitchMonitorGeneration = 0;
let silentSwitchMonitorTimeout: ReturnType<typeof setTimeout> | undefined;
let silentSwitchOn = false;
let silentSwitchMonitoringSupported = false;
const silentSwitchListeners = new Set<SilentSwitchListener>();

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadRoundSounds(sounds: RoundSoundId[]) {
  return Promise.all(sounds.map(resolveRoundSoundUri));
}

export function subscribeToSilentSwitch(listener: SilentSwitchListener) {
  silentSwitchListeners.add(listener);
  return () => {
    silentSwitchListeners.delete(listener);
  };
}

export async function prepareRoundSoundsForPlayback() {
  if (Platform.OS !== 'ios') return;
  const { probeSilentSwitch, supportsSilentSwitchMonitoring } =
    await import('whatz-it-video-export');
  silentSwitchMonitoringSupported = supportsSilentSwitchMonitoring();
  if (!silentSwitchMonitoringSupported) return;

  silentSwitchMonitorGeneration += 1;
  const generation = silentSwitchMonitorGeneration;
  if (silentSwitchMonitorTimeout) clearTimeout(silentSwitchMonitorTimeout);

  const runProbe = async () => {
    try {
      const nextSilentSwitchOn = await probeSilentSwitch();
      if (generation !== silentSwitchMonitorGeneration) return;
      if (silentSwitchOn !== nextSilentSwitchOn) {
        logRoundDiagnostic('silent-switch state changed', {
          silentSwitchOn: nextSilentSwitchOn,
        });
        for (const listener of silentSwitchListeners) listener(nextSilentSwitchOn);
      }
      silentSwitchOn = nextSilentSwitchOn;
    } catch (error) {
      if (generation !== silentSwitchMonitorGeneration) return;
      // Fail closed so a detection problem cannot make a supposedly silent
      // phone emit a live cue. Video cues are recorded independently.
      if (!silentSwitchOn) {
        for (const listener of silentSwitchListeners) listener(true);
      }
      silentSwitchOn = true;
      warnRoundDiagnostic('silent-switch probe failed; suppressing live cues', error);
    }
    if (generation !== silentSwitchMonitorGeneration) return;
    silentSwitchMonitorTimeout = setTimeout(() => void runProbe(), SILENT_SWITCH_PROBE_INTERVAL_MS);
  };

  // The ready screen waits for this first result before beginning its audio.
  await runProbe();
  logRoundDiagnostic('silent-switch monitoring started', { silentSwitchOn });
}

export function stopRoundSoundsAfterRound() {
  silentSwitchMonitorGeneration += 1;
  if (silentSwitchMonitorTimeout) clearTimeout(silentSwitchMonitorTimeout);
  silentSwitchMonitorTimeout = undefined;
  silentSwitchOn = false;
  silentSwitchMonitoringSupported = false;
  logRoundDiagnostic('silent-switch monitoring stopped');
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
      if (
        shouldSuppressLiveRoundSound({
          platform: Platform.OS,
          monitoringSupported: silentSwitchMonitoringSupported,
          silentSwitchOn,
        })
      ) {
        logRoundDiagnostic('live round cue suppressed by silent switch', {
          sound,
          playbackPath: 'expo-audio-gated',
        });
        // Suppression is successful playback policy, not an audio-loading
        // failure. Returning true keeps the ready sequence moving normally.
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
