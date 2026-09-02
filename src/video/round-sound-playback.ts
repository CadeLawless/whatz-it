// Keep the playback-intent lifecycle separate from native status. On Android an
// ended player reports playing=false but retains ExoPlayer's playWhenReady flag.
export type CuePlayer = {
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  play: () => void;
  volume: number;
};

export class RoundSoundPlayback {
  private requests = new WeakMap<CuePlayer, object>();
  private prepared = new WeakSet<CuePlayer>();

  stop(player: CuePlayer) {
    this.requests.delete(player);
    this.prepared.delete(player);
    // Unconditional: playing=false also means ended or buffering, both of
    // which may still have playWhenReady=true and restart on seek/foreground.
    player.pause();
  }

  async prepare(player: CuePlayer, volume: number) {
    const request = {};
    this.requests.set(player, request);
    this.prepared.delete(player);
    player.pause();
    player.volume = volume;
    await player.seekTo(0);
    if (this.requests.get(player) !== request) return false;
    this.prepared.add(player);
    return true;
  }

  async play(player: CuePlayer, volume: number, isCurrent = () => true) {
    if (!isCurrent()) return false;
    const request = {};
    this.requests.set(player, request);
    if (!this.prepared.delete(player)) {
      player.pause();
      player.volume = volume;
      await player.seekTo(0);
    }
    if (this.requests.get(player) !== request || !isCurrent()) return false;
    player.play();
    return true;
  }
}
