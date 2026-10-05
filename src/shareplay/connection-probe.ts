// Phase-0 protocol: deliberately cannot carry cards, purchases, or gameplay actions.
export const PROBE_VERSION = 1;
const MAX_BODY_LENGTH = 512;
const TIMEOUT_MS = 5_000;
type ProbeMessage = { version: 1; kind: 'ping' | 'pong'; nonce: string; environment: string };
export type PeerConnection = 'unchecked' | 'checking' | 'confirmed' | 'timed-out';

export function parseProbe(body: string, environment: string): ProbeMessage | null {
  if (body.length > MAX_BODY_LENGTH) return null;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(',') !== 'environment,kind,nonce,version' ||
        record.version !== PROBE_VERSION || record.environment !== environment ||
        (record.kind !== 'ping' && record.kind !== 'pong') ||
        typeof record.nonce !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(record.nonce)) return null;
    return record as ProbeMessage;
  } catch { return null; }
}

export class ConnectionProbe {
  private pending = new Map<string, { nonce: string; deadline: number }>();
  private peers = new Map<string, PeerConnection>();
  private replies = new Map<string, number>();
  constructor(readonly sessionId: string, private environment: string) {}

  setPeers(ids: string[]) {
    const next = new Set(ids);
    for (const id of this.peers.keys()) {
      if (!next.has(id)) { this.peers.delete(id); this.pending.delete(id); this.replies.delete(id); }
    }
    for (const id of next) if (!this.peers.has(id)) this.peers.set(id, 'unchecked');
  }

  begin(id: string, nonce: string, now: number): string | null {
    if (!this.peers.has(id)) return null;
    const message = JSON.stringify({ version: PROBE_VERSION, kind: 'ping', nonce, environment: this.environment });
    if (!parseProbe(message, this.environment)) return null;
    this.pending.set(id, { nonce, deadline: now + TIMEOUT_MS });
    // Keep a recently confirmed icon green while renewing its liveness check.
    if (this.peers.get(id) !== 'confirmed') this.peers.set(id, 'checking');
    return message;
  }

  receive(sessionId: string, senderId: string, body: string, now: number): string | null {
    if (sessionId !== this.sessionId || !this.peers.has(senderId)) return null;
    const message = parseProbe(body, this.environment);
    if (!message) return null;
    if (message.kind === 'ping') {
      // Bound replies even if a participant floods valid ping messages.
      if (now - (this.replies.get(senderId) ?? -Infinity) < 250) return null;
      this.replies.set(senderId, now);
      return JSON.stringify({ ...message, kind: 'pong' });
    }
    const pending = this.pending.get(senderId);
    if (pending?.nonce === message.nonce && now <= pending.deadline) {
      this.pending.delete(senderId);
      this.peers.set(senderId, 'confirmed');
    }
    return null;
  }

  expire(now: number) {
    for (const [id, request] of this.pending) {
      if (now > request.deadline) { this.pending.delete(id); this.peers.set(id, 'timed-out'); }
    }
  }

  snapshot(): Record<string, PeerConnection> { return Object.fromEntries(this.peers); }
}
