import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';
import { playRoundHaptic } from 'whatz-it-video-export';

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

export async function triggerRoundHaptic(
  cue: RoundHapticCue,
  { cameraActive, countdownValue }: RoundHapticOptions,
) {
  const startedAt = Date.now();
  // Always use the original camera-active native path on iOS so microphone
  // permission and recording state cannot select a different vibration set.
  const useIosNativeHaptics = Platform.OS === 'ios';
  const requestedPattern = describeRequestedPattern(cue, countdownValue);
  const feedbackPath = useIosNativeHaptics ? 'ios-native-feedback-generator' : 'expo-haptics';

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
        const nativePath = await playRoundHaptic(cue, countdownValue ?? null);
        logRoundDiagnostic('iOS camera-safe native feedback started', {
          cue,
          nativePath,
          requestedPattern,
        });
      } catch (nativeError) {
        warnRoundDiagnostic('iOS native feedback failed; using fallback feedback', nativeError, {
          cameraActive,
          cue,
          requestedPattern,
        });
        if (cameraActive) {
          dispatchIosCameraFallback(cue, countdownValue);
          logRoundDiagnostic('iOS camera vibration fallback dispatched', {
            actualPattern: describeIosFallback(cue, countdownValue),
            cue,
          });
        } else {
          await performStyledHaptic(cue, countdownValue);
        }
      }
    } else {
      await performStyledHaptic(cue, countdownValue);
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

async function performStyledHaptic(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  switch (cue) {
    case 'card-flip':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'correct':
      dispatchSystemVibrationSeries(1);
      return;
    case 'pass':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    case 'get-ready':
      await performImpactSeries(Haptics.ImpactFeedbackStyle.Medium, 2);
      return;
    case 'initial-countdown':
      await performImpactSeries(
        Haptics.ImpactFeedbackStyle.Light,
        countdownValue ? 4 - countdownValue : 1,
      );
      return;
    case 'final-countdown':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
      return;
    case 'times-up':
      dispatchSystemVibrationSeries(3);
  }
}

async function performImpactSeries(style: Haptics.ImpactFeedbackStyle, count: number) {
  for (let index = 0; index < count; index += 1) {
    if (index > 0) await delay(QUICK_IMPACT_GAP_MS);
    await Haptics.impactAsync(style);
  }
}

function dispatchIosCameraFallback(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  Vibration.cancel();
  switch (cue) {
    case 'correct':
      dispatchSystemVibrationSeries(1);
      return;
    case 'get-ready':
      Vibration.vibrate([0, 500]);
      return;
    case 'times-up':
      dispatchSystemVibrationSeries(3);
      return;
    case 'initial-countdown':
      if (countdownValue === 2) {
        Vibration.vibrate([0, 500]);
      } else if (countdownValue === 1) {
        Vibration.vibrate([0, 450, 450]);
      } else {
        Vibration.vibrate();
      }
      return;
    default:
      Vibration.vibrate();
  }
}

function describeRequestedPattern(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  switch (cue) {
    case 'card-flip':
      return 'Medium impact';
    case 'correct':
      return 'one long system vibration at system-controlled strength';
    case 'pass':
      return 'Medium impact';
    case 'get-ready':
      return 'two quick Medium impacts';
    case 'initial-countdown':
      return `${countdownValue ? 4 - countdownValue : 1} increasing Light impact(s)`;
    case 'final-countdown':
      return 'Rigid impact';
    case 'times-up':
      return 'three long system vibrations at system-controlled strength';
  }
}

function describeIosFallback(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  if (cue === 'correct') return 'one fixed system-vibration pulse';
  if (cue === 'get-ready') return 'two fixed system-vibration pulses';
  if (cue === 'times-up') return 'three fixed system-vibration pulses';
  if (cue === 'initial-countdown') {
    return `${countdownValue ? 4 - countdownValue : 1} fixed system-vibration pulse(s)`;
  }
  return 'one fixed system-vibration pulse';
}

function dispatchSystemVibrationSeries(count: number) {
  Vibration.cancel();
  if (count <= 1) {
    if (Platform.OS === 'ios') {
      Vibration.vibrate();
    } else {
      Vibration.vibrate(450);
    }
    return;
  }
  if (Platform.OS === 'ios') {
    Vibration.vibrate(Array.from({ length: count }, (_, index) => (index === 0 ? 0 : 520)));
    return;
  }
  const pattern = [0];
  for (let index = 0; index < count; index += 1) {
    pattern.push(450);
    if (index < count - 1) pattern.push(150);
  }
  Vibration.vibrate(pattern);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
