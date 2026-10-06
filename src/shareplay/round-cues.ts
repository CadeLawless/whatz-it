import type { RemoteView } from './remote-round';
import type { RoundSoundId } from '../video/round-sound-plan';
import type { RoundHapticCue } from '../utils/round-haptics';

export type SharePlayRoundCue = {
  sound: RoundSoundId; haptic?: RoundHapticCue; countdownValue?: 1 | 2 | 3;
};

// Consume synchronized views, rather than readiness/roster revisions, to avoid
// replaying cues whenever a heartbeat republishes the same round.
export class SharePlayRoundCues {
  private previous: RemoteView | null = null;
  private seen = new Set<string>();

  private once(key: string) {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!);
    return true;
  }

  next(view: RemoteView | null, countdown: number, remainingMs: number): SharePlayRoundCue[] {
    if (!view) return [];
    const previous = this.previous;
    this.previous = view;
    const sameRound = previous?.roundId === view.roundId && previous.sessionId === view.sessionId;
    const cues: SharePlayRoundCue[] = [];
    if (view.phase === 'countdown' && countdown >= 1 && countdown <= 3) {
      const key = `count:${view.sessionId}:${view.roundId}:${view.startsAt}:${countdown}`;
      if (this.once(key)) {
        cues.push({ sound: `count-${countdown}` as RoundSoundId,
          haptic: 'initial-countdown', countdownValue: countdown as 1 | 2 | 3 });
      }
    }
    // Joining an already running/completed round establishes a baseline;
    // it must not replay an old answer or end-of-round cue.
    if (sameRound && view.phase !== previous.phase) {
      if (view.phase === 'playing' && previous.phase === 'countdown') cues.push({ sound: 'round-start' });
      else if (view.phase === 'playing' && previous.phase === 'feedback')
        cues.push({ sound: 'flip', haptic: 'card-flip' });
      else if (view.phase === 'feedback' && view.feedback)
        cues.push({ sound: view.feedback, haptic: view.feedback });
      else if (view.phase === 'results') cues.push({ sound: 'round-end', haptic: 'times-up' });
    }
    const seconds = Math.ceil(remainingMs / 1000);
    if (['playing', 'feedback'].includes(view.phase) && seconds >= 1 && seconds <= 10) {
      const key = `tick:${view.sessionId}:${view.roundId}:${view.deadline}:${seconds}`;
      if (this.once(key)) {
        cues.push({ sound: 'final-tick', haptic: 'final-countdown' });
      }
    }
    return cues;
  }
}
