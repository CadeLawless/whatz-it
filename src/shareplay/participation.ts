import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';

export const REJOIN_SESSION_KEY = 'whatz-it.shareplay.rejoin-session';

export function shouldOfferSharePlayRejoin(session: SharePlaySnapshot, savedNonce: string | null) {
  return !!savedNonce && savedNonce === session.activity?.nonce && !!session.sessionId &&
    !!session.localParticipantId && ['joined', 'waiting'].includes(session.status);
}
export class SharePlayParticipation {
  private sessionId: string | null = null;
  private excluded = new Set<string>();
  private sequences = new Map<string, number>();
  sync(session: SharePlaySnapshot) {
    if (session.sessionId !== this.sessionId) {
      this.sessionId = session.sessionId; this.excluded.clear(); this.sequences.clear();
    }
    for (const id of this.excluded) {
      if (id !== session.localParticipantId && !session.participantIds.includes(id)) this.excluded.delete(id);
    }
  }
  update(id: string, active: boolean, sequence: number) {
    if (sequence <= (this.sequences.get(id) ?? -1)) return false;
    this.sequences.set(id, sequence);
    if (active) this.excluded.delete(id); else this.excluded.add(id);
    return true;
  }
  exclude(id: string) { this.excluded.add(id); }
  isActive(id: string | null) { return !!id && !this.excluded.has(id); }
  project(session: SharePlaySnapshot): SharePlaySnapshot {
    return { ...session, participantIds: session.participantIds.filter((id) => !this.excluded.has(id)),
      isHost: session.isHost && !this.excluded.has(session.localParticipantId ?? '') };
  }
}
