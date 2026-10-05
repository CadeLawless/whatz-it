import { MAX_ROUND_DURATION, MIN_ROUND_DURATION } from '../game/round-duration';
import type { GameMode } from '../game/game-types';
import { canSeeSharePlayAnswer } from './round-roles';

export type RemoteCard = { answer: string; byline: string };
export type RemoteOutcome = 'correct' | 'pass';
export type RemotePhase = 'lobby' | 'countdown' | 'playing' | 'feedback' | 'handoff' | 'paused' | 'results' | 'ended';
export type RemoteResultReason = 'time' | 'cards' | 'players';
export type DeckAgreement = { deckId: string; contentHash: string; sponsorId: string };
export type RemoteRoundConfig = {
  sessionId: string; environment: string; hostId: string; roundId: string;
  participants: string[]; guesserId: string;
  mode?: GameMode;
  durationSeconds: number; deck: DeckAgreement;
  // Supply a shuffled, immutable order from the verified content sponsor.
  cards: RemoteCard[];
};
export type RemoteIntent = {
  protocol: 1; sessionId: string; environment: string; roundId: string;
  intentId: string; revision: number;
} & (
  | { kind: 'ready'; contentHash: string }
  | { kind: 'start' | 'pause' | 'resume' | 'end' }
  | { kind: 'answer'; cardNonce: string; outcome: RemoteOutcome }
  | { kind: 'reveal'; cardNonce: string }
);
export type RemoteView = {
  sessionId: string; roundId: string; revision: number; phase: RemotePhase;
  hostId: string; guesserId: string;
  mode?: GameMode;
  participants: string[]; ready: string[]; deck: DeckAgreement;
  durationSeconds: number;
  startsAt: number | null; deadline: number | null; remainingMs: number;
  score: number; canAnswer: boolean; cardNonce: string | null;
  card: RemoteCard | null; feedback: RemoteOutcome | null;
  resultReason: RemoteResultReason | null;
  results: (RemoteCard & { outcome: RemoteOutcome })[] | null;
};

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Strict command boundary; identity must come from the transport, never the JSON. */
export function parseRemoteIntent(body: string): RemoteIntent | null {
  if (body.length > 2048) return null;
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const keys = ['protocol', 'sessionId', 'environment', 'roundId', 'intentId', 'revision', 'kind'];
    if (v.protocol !== 1 || !identifier(v.sessionId) || !identifier(v.environment) ||
      !identifier(v.roundId) || !identifier(v.intentId) || !Number.isSafeInteger(v.revision) || (v.revision as number) < 0) return null;
    if (v.kind === 'ready') {
      keys.push('contentHash');
      if (!hash(v.contentHash)) return null;
    } else if (v.kind === 'reveal') {
      keys.push('cardNonce');
      if (!identifier(v.cardNonce)) return null;
    } else if (v.kind === 'answer') {
      keys.push('cardNonce', 'outcome');
      if (!identifier(v.cardNonce) || (v.outcome !== 'correct' && v.outcome !== 'pass')) return null;
    } else if (!['start', 'pause', 'resume', 'end'].includes(String(v.kind))) return null;
    if (Object.keys(v).sort().join() !== keys.sort().join()) return null;
    return v as RemoteIntent;
  } catch { return null; }
}

/** Host-only state. Never serialize this object: send viewFor(recipient) instead. */
export class RemoteRound {
  private readonly config: RemoteRoundConfig;
  private members: string[];
  private ready = new Set<string>();
  private readinessRevision = 0;
  private accepted = new Set<string>();
  private revision = 0;
  private phase: RemotePhase = 'lobby';
  private resultReason: RemoteResultReason | null = null;
  private index = 0;
  private nonce: string | null = null;
  private startsAt: number | null = null;
  private deadline: number | null = null;
  private remainingMs: number;
  private feedbackUntil = 0;
  private pendingHandoff = false;
  private outcomes: (RemoteCard & { outcome: RemoteOutcome })[] = [];
  private lastNow = 0;

  constructor(config: RemoteRoundConfig, private readonly nextNonce: () => string) {
    const ids = [config.sessionId, config.environment, config.hostId, config.roundId, ...config.participants];
    if (!ids.every(identifier) || config.participants.length < 2 ||
      new Set(config.participants).size !== config.participants.length ||
      ![config.hostId, config.guesserId, config.deck.sponsorId].every((id) => config.participants.includes(id)) ||
      (config.mode !== undefined && !['classic', 'pass-n-play'].includes(config.mode)) ||
      !identifier(config.deck.deckId) || !hash(config.deck.contentHash) ||
      !Number.isInteger(config.durationSeconds) || config.durationSeconds < MIN_ROUND_DURATION || config.durationSeconds > MAX_ROUND_DURATION ||
      !config.cards.length || config.cards.length > 1000 || config.cards.some((card) =>
        typeof card.answer !== 'string' || !card.answer.trim() || card.answer.length > 256 ||
        typeof card.byline !== 'string' || card.byline.length > 256)) throw new Error('Invalid remote round configuration');
    this.config = {
      ...config,
      mode: config.mode ?? 'classic',
      participants: [...config.participants],
      deck: { deckId: config.deck.deckId, contentHash: config.deck.contentHash, sponsorId: config.deck.sponsorId },
      cards: config.cards.map(({ answer, byline }) => ({ answer, byline })),
    };
    this.members = [...config.participants];
    this.remainingMs = config.durationSeconds * 1000;
  }

  /** Called with a monotonic host clock, including when no commands arrive. */
  tick(now: number) {
    if (!Number.isFinite(now) || now < this.lastNow) throw new Error('Host clock must be monotonic');
    this.lastNow = now;
    if (this.deadline !== null && now >= this.deadline && !['paused', 'results', 'ended'].includes(this.phase)) {
      this.phase = 'results'; this.resultReason = 'time';
      this.remainingMs = 0; this.nonce = null; this.revision++;
    } else if (this.phase === 'countdown' && this.startsAt !== null && now >= this.startsAt) {
      this.phase = this.pendingHandoff ? 'handoff' : 'playing'; this.nonce = this.nextNonce(); this.revision++;
    } else if (this.phase === 'feedback' && now >= this.feedbackUntil) {
      if (this.pendingHandoff) this.rotateGuesser();
      this.phase = this.pendingHandoff ? 'handoff' : 'playing';
      this.nonce = this.nextNonce(); this.revision++;
    }
  }

  receive(senderId: string, body: string, now: number): 'accepted' | 'duplicate' | 'rejected' {
    this.tick(now);
    const intent = parseRemoteIntent(body);
    if (!intent || intent.sessionId !== this.config.sessionId || intent.environment !== this.config.environment ||
      intent.roundId !== this.config.roundId || !this.members.includes(senderId)) return 'rejected';
    const key = `${senderId}/${intent.intentId}`;
    if (this.accepted.has(key)) return 'duplicate';
    if (this.accepted.size >= 4096 || this.phase === 'ended' || intent.revision > this.revision) return 'rejected';
    // Readiness is concurrent, and answers are guarded by the opaque card nonce.
    // A background pause must still succeed when the sender missed a snapshot.
    // Host start/resume/end controls require the exact current revision.
    if (!['ready', 'answer', 'reveal', 'pause'].includes(intent.kind) && intent.revision !== this.revision) return 'rejected';
    switch (intent.kind) {
      case 'ready':
        if (!['lobby', 'paused'].includes(this.phase) || intent.contentHash !== this.config.deck.contentHash ||
          intent.revision < this.readinessRevision || this.ready.has(senderId)) return 'rejected';
        this.ready.add(senderId);
        break;
      case 'start':
      case 'resume':
        if (senderId !== this.config.hostId || this.phase !== (intent.kind === 'start' ? 'lobby' : 'paused') ||
          this.members.length < 2 || !this.members.every((id) => this.ready.has(id)) ||
          !this.members.includes(this.config.guesserId) ||
          (intent.kind === 'start' && !this.members.includes(this.config.deck.sponsorId))) return 'rejected';
        this.phase = 'countdown'; this.startsAt = now + 3000; this.deadline = this.startsAt + this.remainingMs;
        break;
      case 'answer': {
        if (this.phase !== 'playing' || senderId !== this.config.guesserId || intent.cardNonce !== this.nonce) return 'rejected';
        this.outcomes.push({ answer: this.config.cards[this.index].answer,
          byline: this.config.cards[this.index].byline, outcome: intent.outcome });
        this.index++; this.nonce = null;
        this.phase = this.index === this.config.cards.length ? 'results' : 'feedback';
        if (this.phase === 'results') this.resultReason = 'cards';
        this.feedbackUntil = now + 600;
        this.pendingHandoff = this.config.mode === 'pass-n-play' && intent.outcome === 'correct';
        break;
      }
      case 'reveal':
        if (this.config.mode !== 'pass-n-play' || this.phase !== 'handoff' ||
          senderId !== this.config.guesserId || intent.cardNonce !== this.nonce) return 'rejected';
        this.pendingHandoff = false;
        this.phase = 'playing'; this.nonce = this.nextNonce();
        break;
      case 'pause':
        if (!['countdown', 'playing', 'feedback', 'handoff'].includes(this.phase)) return 'rejected';
        this.pause(now);
        break;
      case 'end':
        if (senderId !== this.config.hostId) return 'rejected';
        this.phase = 'ended'; this.nonce = null;
        break;
    }
    this.accepted.add(key); this.revision++;
    return 'accepted';
  }

  private pause(now: number) {
    if (this.phase === 'feedback' && this.pendingHandoff) this.rotateGuesser();
    this.remainingMs = Math.max(0, (this.deadline ?? now) - Math.max(now, this.startsAt ?? now));
    this.phase = 'paused'; this.nonce = null; this.startsAt = null; this.deadline = null; this.clearReadiness();
  }

  private rotateGuesser() {
    const index = this.members.indexOf(this.config.guesserId);
    this.config.guesserId = this.members[(index + 1) % this.members.length];
  }

  setLobbyMode(mode: GameMode) {
    if (this.phase !== 'lobby' || !['classic', 'pass-n-play'].includes(mode) || mode === this.config.mode) return false;
    this.config.mode = mode; this.clearReadiness(); this.revision++;
    return true;
  }

  private clearReadiness() {
    this.ready.clear();
    // Concurrent ready taps may share a revision, but must acknowledge the most
    // recent interruption or roster change before a round can start again.
    this.readinessRevision = this.revision + 1;
  }

  setLobbyDuration(seconds: number) {
    if (this.phase !== 'lobby' || !Number.isInteger(seconds) ||
      seconds < MIN_ROUND_DURATION || seconds > MAX_ROUND_DURATION ||
      seconds === this.config.durationSeconds) return false;
    this.config.durationSeconds = seconds;
    this.remainingMs = seconds * 1000;
    this.clearReadiness();
    this.revision++;
    return true;
  }

  setLobbyGuesser(guesserId: string) {
    if (this.phase !== 'lobby' || !this.members.includes(guesserId) ||
      guesserId === this.config.guesserId) return false;
    this.config.guesserId = guesserId;
    this.clearReadiness();
    this.revision++;
    return true;
  }

  /** Membership must come from the native session. Active rounds keep running with at least two players. */
  removeParticipant(id: string, now: number) {
    this.tick(now);
    if (!this.members.includes(id)) return;
    this.members = this.members.filter((member) => member !== id);
    this.clearReadiness();
    if (this.members.length < 2) {
      this.phase = 'results'; this.resultReason = 'players'; this.remainingMs = 0;
      this.startsAt = null; this.deadline = null; this.nonce = null;
    } else if (id === this.config.hostId) {
      // The fixed transport host cannot publish another authoritative view.
      this.phase = 'ended'; this.nonce = null;
    } else if (id === this.config.guesserId) {
      // In Classic, a replacement guesser previously saw this answer.
      // In Pass n Play, a replacement clue giver was guessing and never saw it.
      this.config.guesserId = this.members[0];
      if (this.phase === 'playing') {
        if (this.config.mode !== 'pass-n-play') this.index++;
        if (this.index >= this.config.cards.length) {
          this.phase = 'results'; this.resultReason = 'cards'; this.remainingMs = 0;
          this.startsAt = null; this.deadline = null; this.nonce = null;
        } else this.nonce = this.nextNonce();
      } else if (this.phase === 'handoff') {
        this.nonce = this.nextNonce();
      }
    }
    this.revision++;
  }

  addParticipant(id: string, now: number) {
    this.tick(now);
    if (!identifier(id) || this.members.includes(id) ||
      ['results', 'ended'].includes(this.phase)) return;
    this.members.push(id);
    this.clearReadiness();
    this.revision++;
  }

  viewFor(recipient: string, now: number): RemoteView | null {
    this.tick(now);
    if (!this.members.includes(recipient)) return null;
    // Build an allowlisted projection. Never spread host state into a payload.
    const canSeeCard = this.phase === 'playing' &&
      canSeeSharePlayAnswer(this.config.mode, recipient, this.config.guesserId);
    return {
      sessionId: this.config.sessionId, roundId: this.config.roundId, revision: this.revision, phase: this.phase,
      hostId: this.config.hostId, guesserId: this.config.guesserId,
      mode: this.config.mode,
      participants: [...this.members], ready: [...this.ready],
      durationSeconds: this.config.durationSeconds,
      deck: { deckId: this.config.deck.deckId, contentHash: this.config.deck.contentHash,
        sponsorId: this.config.deck.sponsorId },
      startsAt: this.startsAt, deadline: this.deadline,
      remainingMs: this.phase === 'results' ? 0 : this.deadline === null ? this.remainingMs : Math.max(0, this.deadline - Math.max(now, this.startsAt ?? now)),
      score: this.outcomes.filter((item) => item.outcome === 'correct').length,
      canAnswer: this.phase === 'playing' && recipient === this.config.guesserId,
      cardNonce: ['playing', 'handoff'].includes(this.phase) && recipient === this.config.guesserId ? this.nonce : null,
      card: canSeeCard ? { answer: this.config.cards[this.index].answer,
        byline: this.config.cards[this.index].byline } : null,
      feedback: this.phase === 'feedback' ? this.outcomes.at(-1)?.outcome ?? null : null,
      resultReason: this.phase === 'results' ? this.resultReason : null,
      results: this.phase === 'results' ? this.outcomes.map((item) =>
        ({ answer: item.answer, byline: item.byline, outcome: item.outcome })) : null,
    };
  }
}
