/** Clock samples use monotonic clocks on both phones, never wall-clock dates. */
export class RemoteClock {
  private pending = new Map<string, number>();
  private samples: { offset: number; rtt: number; at: number }[] = [];

  begin(nonce: string, now: number) {
    if (!Number.isFinite(now) || now < 0 || this.pending.has(nonce)) return false;
    for (const [id, sent] of this.pending) if (now - sent > 5000) this.pending.delete(id);
    if (this.pending.size >= 8) return false;
    this.pending.set(nonce, now);
    return true;
  }

  reply(nonce: string, hostReceived: number, hostSent: number, localReceived: number) {
    const localSent = this.pending.get(nonce);
    if (localSent === undefined) return false;
    this.pending.delete(nonce);
    if (![hostReceived, hostSent, localReceived].every(Number.isFinite) ||
      hostReceived < 0 || hostSent < hostReceived || localReceived < localSent) return false;
    const rtt = localReceived - localSent - (hostSent - hostReceived);
    if (rtt < 0 || rtt > 1000 || localReceived - localSent > 5000) return false;
    const offset = ((hostReceived - localSent) + (hostSent - localReceived)) / 2;
    if (!Number.isFinite(offset)) return false;
    this.samples = [...this.samples.filter((s) => localReceived - s.at < 30000), { offset, rtt, at: localReceived }].slice(-8);
    return true;
  }

  hostNow(localNow: number): number | null {
    const fresh = this.samples.filter((s) => localNow >= s.at && localNow - s.at < 30000);
    if (fresh.length < 3) return null;
    const best = fresh.reduce((a, b) => a.rtt <= b.rtt ? a : b);
    const hostTime = localNow + best.offset;
    return best.rtt <= 500 && Number.isFinite(hostTime) && hostTime >= 0 ? hostTime : null;
  }

  reset() { this.pending.clear(); this.samples = []; }
}
