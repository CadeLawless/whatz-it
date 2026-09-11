import type { RoundHapticCue } from '../utils/round-haptics';

export type AndroidHapticPattern = { timings: number[]; amplitudes: number[] };

/** A single motor cannot express two patterns at once. State changes start
 * immediately; at most one interrupted/overlapping clock tick follows them. */
export class AndroidHapticScheduler {
  private until = 0;
  private activeCue: RoundHapticCue | null = null;
  private activePattern: AndroidHapticPattern | null = null;
  private pendingTick: AndroidHapticPattern | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private dispatch: (cue: RoundHapticCue, pattern: AndroidHapticPattern) => void,
    private now = () => performance.now(),
    private schedule = (callback: () => void, ms: number) => setTimeout(callback, ms),
    private unschedule = (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  ) {}

  request(cue: RoundHapticCue, pattern: AndroidHapticPattern) {
    if (cue === 'times-up' || cue === 'get-ready' || cue === 'initial-countdown') this.clearTick();
    if (cue === 'final-countdown' && this.now() < this.until) {
      this.pendingTick = pattern;
      this.scheduleTick();
      return;
    }
    if ((cue === 'correct' || cue === 'pass' || cue === 'card-flip') && this.activeCue === 'final-countdown' && this.now() < this.until) {
      this.pendingTick = this.activePattern;
    }
    this.start(cue, pattern);
    if (this.pendingTick) this.scheduleTick();
  }

  cancel() {
    this.clearTick();
    this.until = 0;
    this.activeCue = null;
    this.activePattern = null;
  }

  private start(cue: RoundHapticCue, pattern: AndroidHapticPattern) {
    this.dispatch(cue, pattern);
    this.activeCue = cue;
    this.activePattern = pattern;
    this.until = this.now() + pattern.timings.reduce((sum, ms) => sum + ms, 0);
  }

  private scheduleTick() {
    if (this.timeout !== null) this.unschedule(this.timeout);
    // This gap separates motor pulses only; it never gates input, UI or audio.
    this.timeout = this.schedule(() => {
      const pattern = this.pendingTick;
      this.clearTick();
      if (pattern) this.start('final-countdown', pattern);
    }, Math.max(0, this.until - this.now()) + 40);
  }

  private clearTick() {
    if (this.timeout !== null) this.unschedule(this.timeout);
    this.timeout = null;
    this.pendingTick = null;
  }
}
