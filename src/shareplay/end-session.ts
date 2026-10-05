import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';

export function isLastSharePlayParticipant(session: SharePlaySnapshot) {
  return session.status === 'joined' && !!session.localParticipantId &&
    session.participantIds.length === 1 && session.participantIds[0] === session.localParticipantId;
}

/** Native end is authoritative; targeted leave messages support older bridges. */
export async function endSharePlaySession(actions: {
  notifyParticipants: () => Promise<void>;
  endNativeSession: () => Promise<void>;
  leaveNativeSession: () => Promise<void>;
  onFailure: (stage: 'broadcast' | 'native', error: unknown) => void;
}) {
  let notified = false;
  try { await actions.notifyParticipants(); notified = true; }
  catch (error) { actions.onFailure('broadcast', error); }
  try { await actions.endNativeSession(); }
  catch (error) {
    actions.onFailure('native', error);
    if (!notified) throw error;
    await actions.leaveNativeSession();
  }
}
