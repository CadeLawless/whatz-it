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

// This is a hard export ceiling for the clean cue bus. The voice-processed
// microphone remains at 1.0 for the entire video.
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
  // correct: 0.8,
  // 'round-start': 0.7,
};

const soundUriPromises = new Map<RoundSoundId, Promise<string>>();
const playbackListeners = new Set<RoundSoundPlaybackListener>();
const pendingPlaybackResults = new Set<Promise<void>>();
let nativeCuePlaybackPrepared = false;
let nextPlaybackRequestId = 1;

// Begin decoder/buffer preparation as soon as the bundle loads. Expo players
// remain available for Android and as a fallback for older iOS app binaries.
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

export async function prepareRoundSoundsForPlayback() {
  if (Platform.OS !== 'ios') return;
  const sounds = Object.keys(ROUND_SOUND_SOURCES) as RoundSoundId[];
  const uris = await preloadRoundSounds(sounds);
  const { prepareSystemSound, supportsSilentAwareCueReceipts } =
    await import('whatz-it-video-export');
  nativeCuePlaybackPrepared = supportsSilentAwareCueReceipts();
  if (!nativeCuePlaybackPrepared) {
    logRoundDiagnostic('native silent-aware cue playback unavailable; using Expo fallback');
    return;
  }
  const liveVolumes = sounds.map(getRoundLiveSoundVolume);
  await Promise.all(
    uris.map((uri, index) => prepareSystemSound(uri, liveVolumes[index])),
  );
  logRoundDiagnostic('native silent-aware cue playback prepared', {
    soundCount: sounds.length,
    liveVolumes: Object.fromEntries(sounds.map((sound, index) => [sound, liveVolumes[index]])),
  });
}

export function stopRoundSoundsAfterRound() {
  logRoundDiagnostic('round sound session stopped', {
    pendingPlaybackResultCount: pendingPlaybackResults.size,
  });
  nativeCuePlaybackPrepared = false;
}

export async function waitForPendingRoundSoundResults(timeoutMs = 2_500) {
  const pending = [...pendingPlaybackResults];
  if (pending.length === 0) return true;
  let timedOut = false;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs),
    ),
  ]);
  logRoundDiagnostic('pending round sound results settled', {
    pendingCount: pending.length,
    remainingCount: pendingPlaybackResults.size,
    timedOut,
    timeoutMs,
  });
  return !timedOut;
}

export async function playRoundSound(player: AudioPlayer, sound: RoundSoundId) {
  const requestedAt = Date.now();
  const requestId = `${requestedAt}-${nextPlaybackRequestId++}`;
  emitPlaybackEvent({ phase: 'requested', requestId, requestedAt, sound });
  logRoundDiagnostic('audio cue requested', {
    requestId,
    sound,
    nativeCuePlaybackPrepared,
    playerDuration: player.duration,
    playerIsLoaded: player.isLoaded,
  });

  if (Platform.OS === 'ios' && nativeCuePlaybackPrepared) {
    try {
      const uri = await resolveRoundSoundUri(sound);
      const liveVolume = getRoundLiveSoundVolume(sound);
      const { playSystemSound } = await import('whatz-it-video-export');
      const result = playSystemSound(uri, liveVolume)
        .then((wasAudible) => {
          emitPlaybackEvent({
            phase: 'resolved',
            requestId,
            requestedAt,
            sound,
            wasAudible,
          });
          logRoundDiagnostic('native audio cue result received', {
            requestId,
            sound,
            wasAudible,
          });
        })
        .catch((error) => {
          emitPlaybackEvent({
            phase: 'resolved',
            requestId,
            requestedAt,
            sound,
            wasAudible: false,
          });
          warnVideoDiagnostic('native round cue result failed; excluding cue from export', error, {
            requestId,
            sound,
          });
        })
        .finally(() => pendingPlaybackResults.delete(result));
      pendingPlaybackResults.add(result);
      logVideoDiagnostic('native silent-aware round cue dispatched', {
        requestId,
        sound,
        uri,
        liveVolume,
      });
      return true;
    } catch (error) {
      emitPlaybackEvent({
        phase: 'resolved',
        requestId,
        requestedAt,
        sound,
        wasAudible: false,
      });
      warnVideoDiagnostic('native round cue dispatch failed', error, { requestId, sound });
      return false;
    }
  }

  if (!player.isLoaded) {
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      wasAudible: false,
    });
    warnVideoDiagnostic('round cue skipped because its player is not loaded', undefined, {
      requestId,
      sound,
    });
    return false;
  }

  try {
    const volume = getRoundLiveSoundVolume(sound);
    if (player.playing) player.pause();
    if (player.currentTime > 0.005) await player.seekTo(0);
    if (!player.isLoaded) {
      emitPlaybackEvent({
        phase: 'resolved',
        requestId,
        requestedAt,
        sound,
        wasAudible: false,
      });
      return false;
    }
    player.volume = volume;
    player.play();
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      wasAudible: true,
    });
    logVideoDiagnostic('Expo fallback round cue started', {
      requestId,
      sound,
      volume,
    });
    return true;
  } catch (error) {
    emitPlaybackEvent({
      phase: 'resolved',
      requestId,
      requestedAt,
      sound,
      wasAudible: false,
    });
    warnVideoDiagnostic('round cue playback failed', error, { requestId, sound });
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
