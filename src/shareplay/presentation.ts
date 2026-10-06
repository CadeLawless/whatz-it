import type { RemotePhase } from './remote-round';

/** Joined sessions always own a visible screen, including while state is recovering. */
export function sharePlaySurface({ enabled, joined, setupOpen, localAvailable, gameVisible, phase, rejoinOffered }: {
  enabled: boolean; joined: boolean; setupOpen: boolean; localAvailable: boolean;
  gameVisible: boolean; phase: RemotePhase | undefined;
  rejoinOffered?: boolean;
}): 'setup' | 'lobby' | 'round' | 'rejoin' | null {
  if (!enabled) return null;
  if (rejoinOffered) return 'rejoin';
  if (joined) return gameVisible && phase !== 'lobby' ? 'round' : 'lobby';
  return setupOpen && localAvailable ? 'setup' : null;
}

export function canShowSharePlayRoundOptions(phase: RemotePhase | undefined) {
  return phase !== undefined && ['countdown', 'playing', 'feedback', 'paused'].includes(phase);
}
