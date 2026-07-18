import { Asset } from 'expo-asset';
import { preload, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';
import {
  getRecordingRoundSoundPlaybackStatus,
  getSystemOutputVolume,
  playRecordingRoundSound,
} from 'whatz-it-video-export';

import {
  getRoundLiveVolumeScale,
  stopRoundLiveVolumeControl,
} from '@/video/round-live-volume';
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

export type RoundSoundPlaybackEvent =
  | {
      phase: 'requested';
      requestId: string;
      requestedAt: number;
      sound: RoundSoundId;
    }
  | {
      phase: 'resolved';
      requestId: string;
      requestedAt: number;
      sound: RoundSoundId;
      includeInExport: boolean;
      wasAudible: boolean;
    };

type RoundSoundPlaybackListener = (event: RoundSoundPlaybackEvent) => void;

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

// This is a hard export ceiling for a cue that failed to play live. Successful
// native cues are already present naturally in the unprocessed microphone.
export const ROUND_VIDEO_SOUND_VOLUME = 0.08;

// The single bundled sound set is peak-normalized for louder live playback.
// Export multiplies by the inverse of these source gains so every cue retains
// the video loudness it had before normalization.
const ROUND_LIVE_SOURCE_GAINS: Record<RoundSoundId, number> = {
  'get-ready': 1.266215831,
  'count-3': 2.017541642,
  'count-2': 2.017541642,
  'count-1': 2.017541642,
  'round-start': 1.334275611,
  'final-tick': 1.385651013,
  correct: 1,
  pass: 1.289344738,
  flip: 1.511392989,
  'round-end': 1.841605041,
};

// Add only the live sounds that need to be quieter. Values are clamped to
// 0.05...1, where 1 is the full source volume. Video export does not use this
// map, so these adjustments cannot change the finished video's cue levels.
const DEFAULT_ROUND_SOUND_VOLUME = 1;
export const ROUND_SOUND_VOLUMES: Partial<Record<RoundSoundId, number>> = {
  correct: 0.4,
  flip: 0.7,
  'round-start': 0.65,
};

const soundUriPromises = new Map<RoundSoundId, Promise<string>>();
const playbackListeners = new Set<RoundSoundPlaybackListener>();
let nextPlaybackRequestId = 1;
let recordingCuePlaybackActive = false;

// Begin decoder/buffer preparation as soon as the bundle loads.
for (const [sound, source] of Object.entries(ROUND_SOUND_SOURCES)) {
  void preload(source)
    .then(() => logRoundDiagnostic('native audio preload completed', { sound }))
    .catch((error) => warnRoundDiagnostic('native audio preload failed', error, { sound }));
}

export function getRoundSoundSource(sound: RoundSoundId) {
  return ROUND_SOUND_SOURCES[sound];
}

export function preloadRoundSounds(sounds: RoundSoundId[]) {
  return Promise.all(sounds.map(resolveRoundSoundUri));
}

export function subscribeToRoundSoundPlayback(listener: RoundSoundPlaybackListener) {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

export function setRecordingCuePlaybackActive(active: boolean) {
  recordingCuePlaybackActive = active;
  logRoundDiagnostic('recording-engine round cue playback state changed', {
    active,
    platform: Platform.OS,
  });
}

export function isRecordingCuePlaybackActive() {
  return Platform.OS === 'ios' && recordingCuePlaybackActive;
}

export async function resolveRoundRecordingSoundSources() {
  const sounds = Object.keys(ROUND_SOUND_SOURCES) as RoundSoundId[];
  return Promise.all(
    sounds.map(async (sound) => ({
      sound,
      uri: await resolveRoundSoundUri(sound),
    })),
  );
}

export async function prepareRoundSoundsForPlayback() {
  const sounds = Object.keys(ROUND_SOUND_SOURCES) as RoundSoundId[];
  await preloadRoundSounds(sounds);
  const liveVolumes = sounds.map(getRoundLiveSoundVolume);
  logRoundDiagnostic('Expo round sound playback prepared', {
    playbackPath: 'expo-audio',
    ignoresSilentSwitch: true,
    soundCount: sounds.length,
    liveVolumes: Object.fromEntries(sounds.map((sound, index) => [sound, liveVolumes[index]])),
  });
}

export function stopRoundSoundsAfterRound() {
  stopRoundLiveVolumeControl();
  logRoundDiagnostic('round sound session stopped', {
    playbackPath: 'expo-audio',
  });
}

export async function waitForPendingRoundSoundResults(timeoutMs = 2_500) {
  logRoundDiagnostic('round sound playback results already resolved', {
    playbackPath: 'expo-audio',
    pendingCount: 0,
    timeoutMs,
  });
  return true;
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId) {
  const requestedAt = Date.now();
  const requestId = `${requestedAt}-${nextPlaybackRequestId++}`;
  emitPlaybackEvent({ phase: 'requested', requestId, requestedAt, sound });
  logRoundDiagnostic('audio cue requested', {
    requestId,
    sound,
    playbackPath: isRecordingCuePlaybackActive() ? 'recording-audio-engine' : 'expo-audio',
    ignoresSilentSwitch: true,
    playerDuration: player.duration,
    playerIsLoaded: player.isLoaded,
  });

  // Feed live cues through the same unprocessed recording engine as the mic.
  // A successful cue is already captured acoustically, so export must not add
  // a second clean copy. If native playback fails, export inserts the cue once.
  if (isRecordingCuePlaybackActive()) {
    const volumeState = getRoundLivePlayerVolume(sound);
    try {
      const nativePlaybackStarted = await playRecordingRoundSound(
        sound,
        volumeState.playerVolume,
      );
      if (nativePlaybackStarted) {
        emitPlaybackEvent({
          phase: 'resolved',
          requestId,
          requestedAt,
          sound,
          includeInExport: false,
          wasAudible: true,
        });
        logVideoDiagnostic('recording audio engine round cue started', {
          requestId,
          sound,
          ...volumeState,
        });
        return true;
      }
      emitPlaybackEvent({
        phase: 'resolved',
        requestId,
        requestedAt,
        sound,
        includeInExport: true,
        wasAudible: false,
      });
      warnVideoDiagnostic('recording audio engine cue unavailable; Expo fallback disabled', undefined, {
        includeInExport: true,
        nativePlaybackStatus: getRecordingRoundSoundPlaybackStatus(sound),
        requestId,
        sound,
      });
      return false;
    } catch (error) {
      emitPlaybackEvent({
        phase: 'resolved',
        requestId,
        requestedAt,
        sound,
        includeInExport: true,
        wasAudible: false,
      });
      warnVideoDiagnostic('recording audio engine cue failed; Expo fallback disabled', error, {
        includeInExport: true,
        nativePlaybackStatus: getRecordingRoundSoundPlaybackStatus(sound),
        requestId,
        sound,
      });
      return false;
    }
  }

  if (!player.isLoaded) {
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      includeInExport: false,
      wasAudible: false,
    });
    warnVideoDiagnostic('round cue skipped because its player is not loaded', undefined, {
      requestId,
      sound,
    });
    return false;
  }

  try {
    const volumeState = getRoundLivePlayerVolume(sound);
    if (player.playing) player.pause();
    if (player.currentTime > 0.005) await player.seekTo(0);
    if (!player.isLoaded) {
      emitPlaybackEvent({
        phase: 'resolved',
        requestId,
        requestedAt,
        sound,
        includeInExport: false,
        wasAudible: false,
      });
      return false;
    }
    player.volume = volumeState.playerVolume;
    player.play();
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      includeInExport: true,
      wasAudible: true,
    });
    logVideoDiagnostic('Expo round cue started', {
      requestId,
      sound,
      ...volumeState,
      ignoresSilentSwitch: true,
    });
    return true;
  } catch (error) {
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      includeInExport: false,
      wasAudible: false,
    });
    warnVideoDiagnostic('round cue playback failed', error, { requestId, sound });
    return false;
  }
}

export function getCurrentRoundLiveVolumeScale() {
  const systemOutputVolume = Platform.OS === 'ios' ? getSystemOutputVolume() : null;
  return getRoundLiveVolumeScale(systemOutputVolume);
}

export function syncRoundSoundPlayerVolume(
  player: AudioPlayer,
  sound: RoundSoundId,
  liveVolumeScale = getCurrentRoundLiveVolumeScale(),
) {
  player.volume = getRoundLiveSoundVolume(sound) * liveVolumeScale;
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
      volumeScale: 1 / ROUND_LIVE_SOURCE_GAINS[cue.sound],
    })),
  );
}

function emitPlaybackEvent(event: RoundSoundPlaybackEvent) {
  for (const listener of playbackListeners) listener(event);
}

function getRoundLiveSoundVolume(sound: RoundSoundId) {
  const configuredVolume = ROUND_SOUND_VOLUMES[sound] ?? DEFAULT_ROUND_SOUND_VOLUME;
  return Number.isFinite(configuredVolume)
    ? Math.max(0.05, Math.min(1, configuredVolume))
    : 1;
}

function getRoundLivePlayerVolume(sound: RoundSoundId) {
  const baseVolume = getRoundLiveSoundVolume(sound);
  const systemOutputVolume = Platform.OS === 'ios' ? getSystemOutputVolume() : null;
  const liveVolumeScale = getRoundLiveVolumeScale(systemOutputVolume);
  return {
    baseVolume,
    liveVolumeScale,
    playerVolume: baseVolume * liveVolumeScale,
    systemOutputVolume,
  };
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
