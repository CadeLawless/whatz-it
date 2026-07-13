import type { AudioPlayer } from 'expo-audio';

export function replaySound(player: AudioPlayer) {
  try {
    player.seekTo(0);
    player.play();
  } catch {
    // Sound should never interrupt a round if audio is unavailable.
  }
}
