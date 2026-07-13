import type { AudioPlayer } from 'expo-audio';

export async function replaySound(player: AudioPlayer) {
  try {
    await player.seekTo(0);
    player.play();
  } catch {
    // Sound should never interrupt a round if audio is unavailable.
  }
}
