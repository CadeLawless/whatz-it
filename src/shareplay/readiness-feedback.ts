import type { RemotePhase } from './remote-round';

/** Track confirmed local readiness across replacement views and round changes. */
export class SharePlayReadinessFeedback {
  private identity: string | null = null;
  private ready: boolean | null = null;

  update(identity: string | null, ready: boolean | null, phase?: RemotePhase) {
    // Readiness is consumed when play starts. A completed round returning to
    // the lobby establishes fresh readiness rather than unreadying a player.
    if (phase && !['lobby', 'paused'].includes(phase)) ready = false;
    if (identity !== this.identity || identity === null) {
      this.identity = identity; this.ready = ready;
      return false;
    }
    // Missing snapshots do not prove readiness was cleared.
    if (ready === null) return false;
    const unreadied = this.ready === true && ready === false;
    this.ready = ready;
    return unreadied && (!phase || ['lobby', 'paused'].includes(phase));
  }
}

