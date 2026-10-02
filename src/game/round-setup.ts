import type { GameMode } from '@/game/game-types';

export async function requestModePermissions(
  mode: GameMode,
  requestMotion: () => Promise<void>,
  requestVideo: () => Promise<void>,
) {
  if (mode === 'classic') await requestMotion();
  await requestVideo().catch(() => undefined);
}
