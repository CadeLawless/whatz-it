type Packet = { from: string; to: string; body: string; due: number; order: number };

/** Deterministic test transport. A disconnect also discards in-flight packets. */
export class SimulatedTransport {
  private receivers = new Map<string, (from: string, body: string) => void>();
  private packets: Packet[] = [];
  private sequence = 0;
  now = 0;

  connect(id: string, receive: (from: string, body: string) => void) { this.receivers.set(id, receive); }
  disconnect(id: string) {
    this.receivers.delete(id);
    this.packets = this.packets.filter((p) => p.from !== id && p.to !== id);
  }

  send(from: string, to: string, body: string, options: { delay?: number; drop?: boolean; duplicate?: boolean } = {}) {
    if (!this.receivers.has(from) || !this.receivers.has(to) || options.drop) return;
    const delay = options.delay ?? 0;
    if (!Number.isFinite(delay) || delay < 0) throw new Error('Invalid delay');
    if (this.packets.length >= 10000) throw new Error('Simulation queue full');
    this.packets.push({ from, to, body, due: this.now + delay, order: this.sequence++ });
    if (options.duplicate) this.packets.push({ from, to, body, due: this.now + delay + 1, order: this.sequence++ });
  }

  advance(now: number) {
    if (!Number.isFinite(now) || now < this.now) throw new Error('Simulation clock must be monotonic');
    let delivered = 0;
    while (true) {
      this.packets.sort((a, b) => a.due - b.due || a.order - b.order);
      const packet = this.packets[0];
      if (!packet || packet.due > now) break;
      if (++delivered > 10000) throw new Error('Simulation delivery loop');
      this.packets.shift(); this.now = packet.due;
      if (this.receivers.has(packet.from)) this.receivers.get(packet.to)?.(packet.from, packet.body);
    }
    this.now = now;
  }
}
