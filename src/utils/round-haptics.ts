import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import {
  cancelAndroidRoundWaveform,
  cancelRoundHapticPlayback,
  hasAndroidRoundHapticAmplitudeControl,
  playAndroidRoundWaveform,
  playRoundHaptic,
} from 'whatz-it-video-export';
import { androidHapticPattern } from '../game/android-haptic-pattern';
import { AndroidHapticScheduler } from '../game/android-haptic-scheduler';
import { traceAndroidGameplay } from './android-gameplay-trace';

import { logRoundDiagnostic, warnRoundDiagnostic } from '@/video/video-diagnostics';

export type RoundHapticCue =
  | 'card-flip'
  | 'correct'
  | 'pass'
  | 'get-ready'
  | 'initial-countdown'
  | 'final-countdown'
  | 'times-up';

type RoundHapticOptions = {
  cameraActive: boolean;
  countdownValue?: 1 | 2 | 3;
};

const QUICK_IMPACT_GAP_MS = 80;
// These values live in the updateable JavaScript bundle. The native player
// clamps them to safe ranges before creating a Core Haptics pattern.
const IOS_STRONG_PULSE_DURATION_MS = 450;
const IOS_TIMES_UP_PULSE_INTERVAL_MS = 520;
let hapticGeneration = 0;
const androidScheduler = new AndroidHapticScheduler((cue, { timings, amplitudes }) => {
  try {
    traceAndroidGameplay('haptic.dispatch', { cue, timings });
    if (!playAndroidRoundWaveform(timings, amplitudes)) {
      Vibration.cancel();
      Vibration.vibrate(timings, false);
    }
    traceAndroidGameplay('haptic.dispatch-returned', { cue });
  } catch (error) {
    warnRoundDiagnostic('Android round waveform failed', error, { cue });
  }
});
const pendingDelays = new Map<ReturnType<typeof setTimeout>, () => void>();

export function cancelRoundHaptics() {
  hapticGeneration += 1;
  for (const [timeout, resolve] of pendingDelays) {
    clearTimeout(timeout);
    resolve();
  }
  pendingDelays.clear();
  if (Platform.OS === 'android') {
    androidScheduler.cancel();
    cancelAndroidRoundWaveform();
  } else if (Platform.OS === 'ios') {
    cancelRoundHapticPlayback();
  }
  Vibration.cancel();
}

export async function triggerRoundHaptic(
  cue: RoundHapticCue,
  { cameraActive, countdownValue }: RoundHapticOptions,
) {
  if (Platform.OS === 'android') {
    traceAndroidGameplay('haptic.request', { cue });
    androidScheduler.request(cue, androidHapticPattern(cue, countdownValue, hasAndroidRoundHapticAmplitudeControl()));
    return;
  }
  const generation = hapticGeneration;
  const startedAt = Date.now();
  // Keep every iOS cue on the same Core Haptics engine whether or not the
  // optional round recording is active.
  const useIosNativeHaptics = Platform.OS === 'ios';
  const requestedPattern = describeRequestedPattern(cue, countdownValue);
  const feedbackPath = useIosNativeHaptics ? 'ios-core-haptics' : 'expo-haptics';

  logRoundDiagnostic('round haptic cue requested', {
    cameraActive,
    countdownValue,
    cue,
    feedbackPath,
    platform: Platform.OS,
    requestedPattern,
  });

  try {
    if (useIosNativeHaptics) {
      try {
        const nativePath = await playRoundHaptic(
          cue,
          countdownValue ?? null,
          IOS_STRONG_PULSE_DURATION_MS,
          IOS_TIMES_UP_PULSE_INTERVAL_MS,
        );
        logRoundDiagnostic('iOS Core Haptics feedback started', {
          cue,
          nativePath,
          requestedPattern,
        });
      } catch (nativeError) {
        if (generation !== hapticGeneration) return;
        warnRoundDiagnostic('iOS native feedback failed; using fallback feedback', nativeError, {
          cameraActive,
          cue,
          requestedPattern,
        });
        await performStyledHaptic(cue, countdownValue, generation);
        logRoundDiagnostic('iOS feedback-generator fallback dispatched', {
          cue,
        });
      }
    } else {
      await performStyledHaptic(cue, countdownValue, generation);
      logRoundDiagnostic('styled round haptic API completed', {
        cue,
        note: 'The native API completed; operating systems do not confirm physical motor output.',
        requestedPattern,
      });
    }
    logRoundDiagnostic('round haptic cue finished', {
      cue,
      elapsedMs: Date.now() - startedAt,
      feedbackPath,
    });
  } catch (error) {
    warnRoundDiagnostic('round haptic cue failed', error, {
      cameraActive,
      cue,
      feedbackPath,
      requestedPattern,
    });
  }
}

async function performStyledHaptic(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3, generation = hapticGeneration) {
  if (generation !== hapticGeneration) return;
  // Android uses a complete waveform above. Keep the existing iOS fallback
  // and web paths separate from that motor lifecycle.
  switch (cue) {
    case 'card-flip':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'correct':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      return;
    case 'pass':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'get-ready':
      await performImpactSeries(Haptics.ImpactFeedbackStyle.Medium, 2, generation);
      return;
    case 'initial-countdown':
      await performImpactSeries(
        Haptics.ImpactFeedbackStyle.Light,
        countdownValue ? 4 - countdownValue : 1,
        generation,
      );
      return;
    case 'final-countdown':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      return;
    case 'times-up':
      await performImpactSeries(Haptics.ImpactFeedbackStyle.Heavy, 3, generation);
  }
}

async function performImpactSeries(style: Haptics.ImpactFeedbackStyle, count: number, generation: number) {
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await delay(QUICK_IMPACT_GAP_MS);
    if (generation !== hapticGeneration) return;
    await Haptics.impactAsync(style);
  }
}

function describeRequestedPattern(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  switch (cue) {
    case 'card-flip':
      return 'Medium impact';
    case 'correct':
      return Platform.OS === 'android'
        ? 'Heavy impact'
        : `one ${IOS_STRONG_PULSE_DURATION_MS} ms maximum-intensity Core Haptics pulse`;
    case 'pass':
      return 'Medium impact';
    case 'get-ready':
      return 'two quick Medium impacts';
    case 'initial-countdown':
      return `${countdownValue ? 4 - countdownValue : 1} increasing Light impact(s)`;
    case 'final-countdown':
      return 'Rigid impact';
    case 'times-up':
      return Platform.OS === 'ios'
        ? `three ${IOS_STRONG_PULSE_DURATION_MS} ms maximum-intensity Core Haptics pulses at ${IOS_TIMES_UP_PULSE_INTERVAL_MS} ms intervals`
        : 'three long system vibrations at system-controlled strength';
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      pendingDelays.delete(timeout);
      resolve();
    }, milliseconds);
    pendingDelays.set(timeout, resolve);
  });
}
