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
  const useIosCameraNativeHaptics = Platform.OS === 'ios' && cameraActive;
  const requestedPattern = describeRequestedPattern(cue, countdownValue);
  const feedbackPath = useIosCameraNativeHaptics
    ? 'ios-native-feedback-generator'
    : 'expo-haptics';

  logRoundDiagnostic('round haptic cue requested', {
    cameraActive,
    countdownValue,
    cue,
    feedbackPath,
    platform: Platform.OS,
    requestedPattern,
  });

  try {
    if (useIosCameraNativeHaptics) {
      try {
        const nativePath = await playRoundHaptic(cue, countdownValue ?? null);
        logRoundDiagnostic('iOS camera-safe native feedback started', {
          cue,
          nativePath,
          requestedPattern,
        });
      } catch (nativeError) {
        warnRoundDiagnostic(
          'iOS native feedback failed; using system vibration fallback',
          nativeError,
          { cue, requestedPattern },
        );
        dispatchIosCameraFallback(cue, countdownValue);
        logRoundDiagnostic('iOS system vibration fallback dispatched', {
          actualPattern: describeIosFallback(cue, countdownValue),
          cue,
        });
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
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    case 'correct':
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    case 'pass':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
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
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      await delay(QUICK_IMPACT_GAP_MS);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    case 'get-ready':
      Vibration.vibrate([0, 500]);
      return;
    case 'times-up':
      Vibration.vibrate([0, 500, 500]);
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
      return 'Light impact';
    case 'correct':
      return 'Success notification';
    case 'pass':
      return 'Soft impact';
    case 'get-ready':
      return 'two quick Medium impacts';
    case 'initial-countdown':
      return `${countdownValue ? 4 - countdownValue : 1} increasing Light impact(s)`;
    case 'final-countdown':
      return 'Rigid impact';
    case 'times-up':
      return 'Heavy impact followed by Success notification';
  }
}

function describeIosFallback(cue: RoundHapticCue, countdownValue?: 1 | 2 | 3) {
  if (cue === 'correct' || cue === 'get-ready') return 'two fixed system-vibration pulses';
  if (cue === 'times-up') return 'three fixed system-vibration pulses';
  if (cue === 'initial-countdown') {
    return `${countdownValue ? 4 - countdownValue : 1} fixed system-vibration pulse(s)`;
  }
  return 'one fixed system-vibration pulse';
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
