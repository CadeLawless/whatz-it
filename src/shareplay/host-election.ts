import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';

export const HOST_SILENCE_TIMEOUT_MS = 5_000;
export const REJOIN_LOBBY_TIMEOUT_MS = 8_000;
export function rejoinLobbyRecoveryTarget(snapshot: SharePlaySnapshot, acceptedSessionId: string | null,
  allConnected: boolean, missingSince: number | null, now: number) {
  if (snapshot.status !== 'joined' || !snapshot.sessionId ||
    snapshot.sessionId !== acceptedSessionId || !snapshot.localParticipantId ||
    !snapshot.participantIds.includes(snapshot.localParticipantId) ||
    snapshot.participantIds.length < 2 || !allConnected || missingSince === null ||
    now - missingSince < REJOIN_LOBBY_TIMEOUT_MS) return null;
  return [...snapshot.participantIds].sort()[0];
}
export function shouldRecoverSharePlayHost(snapshot: SharePlaySnapshot, lastSeenAt: number,
  now: number, foreground: boolean) {
  return foreground && snapshot.status === 'joined' && !snapshot.isHost &&
    !!snapshot.hostParticipantId && now - lastSeenAt >= HOST_SILENCE_TIMEOUT_MS;
}

/** Keep the signed inviter while present; otherwise elect from Apple's active roster. */
export function resolveSharePlayHost(snapshot: SharePlaySnapshot, electUnknownHost = false,
  incumbentId: string | null = null): SharePlaySnapshot {
  if (snapshot.status !== 'joined' || !snapshot.sessionId || !snapshot.localParticipantId ||
    snapshot.participantIds.length === 0 ||
    !snapshot.participantIds.includes(snapshot.localParticipantId)) return snapshot;
  if (incumbentId && snapshot.participantIds.includes(incumbentId)) {
    return { ...snapshot, hostParticipantId: incumbentId,
      isHost: snapshot.localParticipantId === incumbentId, electedHost: true };
  }
  if (snapshot.isHost || (snapshot.hostParticipantId &&
    snapshot.participantIds.includes(snapshot.hostParticipantId))) {
    // A process restart can discard the inviter's signing key while Apple's
    // participant identity remains bound to that device.
    if (!snapshot.isHost && snapshot.hostParticipantId === snapshot.localParticipantId) {
      return { ...snapshot, isHost: true, electedHost: true };
    }
    return snapshot;
  }
  if (!snapshot.hostParticipantId && !electUnknownHost) return snapshot;
  const hostParticipantId = [...snapshot.participantIds].sort()[0];
  return { ...snapshot, hostParticipantId,
    isHost: snapshot.localParticipantId === hostParticipantId, electedHost: true };
}

export function acceptsSharePlayHostClaim(currentId: string | null, currentTerm: number,
  senderId: string, term: number, signed: boolean) {
  if (term !== currentTerm) return term > currentTerm;
  if (senderId === currentId || !currentId) return true;
  if (term === 0) return signed;
  // Simultaneous recovery proposals converge on the same transport identity.
  return senderId < currentId;
}

export function recoveryHost(snapshot: SharePlaySnapshot, responsiveIds: string[]) {
  return [...new Set([snapshot.localParticipantId, ...responsiveIds])]
    .filter((id): id is string => !!id && snapshot.participantIds.includes(id) &&
      id !== snapshot.hostParticipantId).sort()[0] ?? snapshot.localParticipantId;
}
