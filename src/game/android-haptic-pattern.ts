import type { RoundHapticCue } from '../utils/round-haptics';

// Alternating silence/pulse durations also work on motors without amplitude
// control. Pulse onsets for the intro and ending match the iOS scheduler.
export function androidHapticPattern(cue: RoundHapticCue, count?: 1 | 2 | 3, amplitudeControl = false) {
  if (!amplitudeControl) {
    // The Samsung's simple motor completes 20-43 ms requests but the player
    // cannot feel them. Give it time to spin up; distinguish pulses by rhythm.
    switch (cue) {
      case 'card-flip': return { timings: [0, 90], amplitudes: [0, 255] };
      case 'pass': return { timings: [0, 90, 90, 90], amplitudes: [0, 255, 0, 255] };
      case 'final-countdown': return { timings: [0, 100], amplitudes: [0, 255] };
      case 'get-ready': return { timings: [0, 110, 90, 110], amplitudes: [0, 255, 0, 255] };
      case 'initial-countdown': {
        const pulses = count ? 4 - count : 1;
        return {
          timings: Array.from({ length: pulses * 2 }, (_, i) => i === 0 ? 0 : i % 2 ? 100 : 80),
          amplitudes: Array.from({ length: pulses * 2 }, (_, i) => i % 2 ? 255 : 0),
        };
      }
    }
  }
  switch (cue) {
    case 'correct': return { timings: [0, 180], amplitudes: [0, 220] };
    case 'pass': return { timings: [0, 43], amplitudes: [0, 150] };
    case 'card-flip': return { timings: [0, 20], amplitudes: [0, 90] };
    case 'final-countdown': return { timings: [0, 30], amplitudes: [0, 180] };
    case 'get-ready': return { timings: [0, 43, 37, 43], amplitudes: [0, 150, 0, 150] };
    case 'initial-countdown': {
      const pulses = count ? 4 - count : 1;
      return {
        timings: Array.from({ length: pulses * 2 }, (_, i) => i === 0 ? 0 : i % 2 ? 20 : 60),
        amplitudes: Array.from({ length: pulses * 2 }, (_, i) => i % 2 ? 90 : 0),
      };
    }
    case 'times-up': return { timings: [0, 450, 70, 450, 70, 450], amplitudes: [0, 220, 0, 220, 0, 220] };
  }
}
