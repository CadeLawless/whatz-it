import type { PeerConnection } from './connection-probe';
import type { RemoteView } from './remote-round';

/** The player starting a round needs a reachable host and one connected friend. */
export function canPlaySharedRound(participantIds: string[], localId: string | null,
  hostId: string | null, peers: Record<string, PeerConnection>) {
  if (!localId || !hostId || !participantIds.includes(localId) || participantIds.length < 2) return false;
  if (hostId !== localId && peers[hostId] !== 'confirmed') return false;
  return participantIds.some((id) => id !== localId && peers[id] === 'confirmed');
}

type PlayAgainView = Pick<RemoteView, 'sessionId' | 'roundId' | 'phase' | 'participants' | 'deck'>;

/** Results may stay visible while a changed roster is prepared as a new lobby. */
export function canPlayAgainFromResults(participantIds: string[], resultsView: PlayAgainView | null,
  currentView: PlayAgainView | null, selectedDeckId: string | null) {
  if (!resultsView || resultsView.phase !== 'results' || !currentView ||
    !['results', 'lobby'].includes(currentView.phase) ||
    currentView.sessionId !== resultsView.sessionId ||
    (currentView.phase === 'results' && currentView.roundId !== resultsView.roundId) ||
    selectedDeckId !== resultsView.deck.deckId ||
    currentView.deck.deckId !== selectedDeckId ||
    participantIds.length < 2 || currentView.participants.length !== participantIds.length) return false;
  return participantIds.every((id) => currentView.participants.includes(id));
}
