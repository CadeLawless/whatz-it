export const SHAREPLAY_REACTIONS = [
  { emoji: '😂', label: 'Face with Tears of Joy' },
  { emoji: '🤨', label: 'Face with Raised Eyebrow' },
  { emoji: '😳', label: 'Flushed Face' },
  { emoji: '🗑️', label: 'Wastebasket' },
] as const;

export const SHAREPLAY_RESULTS_REACTIONS = [
  { emoji: '👏', label: 'Clapping Hands' },
  { emoji: '😬', label: 'Grimacing Face' },
  { emoji: '😳', label: 'Flushed Face' },
  { emoji: '🫣', label: 'Face with Peeking Eye' },
] as const;

export type SharePlayReactionIndex = 0 | 1 | 2 | 3;
export type SharePlayReactionSet = 'round' | 'results';
export type SharePlayReactionEvent = {
  id: string; roundId: string; participantId: string;
  emoji: SharePlayReactionIndex; set: SharePlayReactionSet;
};

export const reactionOptionsFor = (set: SharePlayReactionSet) =>
  set === 'results' ? SHAREPLAY_RESULTS_REACTIONS : SHAREPLAY_REACTIONS;

export const REACTION_COOLDOWN_MS = 800;

export function canReactInPhase(phase: string) {
  return ['countdown', 'playing', 'paused', 'results'].includes(phase);
}

/** Limit each participant and ignore retransmitted reactions. */
export class SharePlayReactionGate {
  private lastByPlayer = new Map<string, number>();
  private seen = new Set<string>();

  accept(roundId: string, participantId: string, reactionId: string, now: number) {
    const key = `${roundId}/${participantId}`;
    const eventId = `${key}/${reactionId}`;
    if (this.seen.has(eventId) || now - (this.lastByPlayer.get(key) ?? -Infinity) < REACTION_COOLDOWN_MS)
      return false;
    this.lastByPlayer.set(key, now);
    this.seen.add(eventId);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    if (this.lastByPlayer.size > 128) this.lastByPlayer.delete(this.lastByPlayer.keys().next().value!);
    return true;
  }

  reset() {
    this.lastByPlayer.clear();
    this.seen.clear();
  }
}
