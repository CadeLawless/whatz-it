import type { PeerConnection } from './connection-probe';

/** The player starting a round needs a reachable host and one connected friend. */
export function canPlaySharedRound(participantIds: string[], localId: string | null,
  hostId: string | null, peers: Record<string, PeerConnection>) {
  if (!localId || !hostId || !participantIds.includes(localId) || participantIds.length < 2) return false;
  if (hostId !== localId && peers[hostId] !== 'confirmed') return false;
  return participantIds.some((id) => id !== localId && peers[id] === 'confirmed');
}
