import type { RoundHapticCue } from '../utils/round-haptics';

export type AndroidHapticPattern = { timings: number[]; amplitudes: number[] };

/** Answer pulses take priority. Skip overlapping clock ticks rather than
 * replaying them later, out of sync with the sound and displayed second. */
export class AndroidHapticScheduler {
  private until = 0;
  private activeCue: RoundHapticCue | null = null;

  constructor(
    private dispatch: (cue: RoundHapticCue, pattern: AndroidHapticPattern) => void,
    private now = () => performance.now(),
  ) {}

  request(cue: RoundHapticCue, pattern: AndroidHapticPattern) {
    if (cue === 'card-flip' && (this.activeCue === 'correct' || this.activeCue === 'pass') && this.now() < this.until) return;
    if (cue === 'final-countdown' && this.now() < this.until) {
      return;
    }
    this.start(cue, pattern);
  }

  cancel() {
    this.until = 0;
    this.activeCue = null;
  }

  private start(cue: RoundHapticCue, pattern: AndroidHapticPattern) {
    this.dispatch(cue, pattern);
    this.activeCue = cue;
    this.until = this.now() + pattern.timings.reduce((sum, ms) => sum + ms, 0);
  }

}
