import { MAX_ROUND_DURATION, MIN_ROUND_DURATION } from '../game/round-duration';
import type { GameMode } from '../game/game-types';
import { canSeeSharePlayAnswer } from './round-roles';

export type RemoteCard = { answer: string; byline: string };
export type RemoteOutcome = 'correct' | 'pass';
export type RemoteResultOutcome = RemoteOutcome | 'neutral';
export type RemotePhase = 'lobby' | 'countdown' | 'playing' | 'feedback' | 'paused' | 'results' | 'ended';
export type RemoteResultReason = 'time' | 'cards' | 'players';
export type DeckAgreement = { deckId: string; contentHash: string; sponsorId: string };
export type RemoteRoundConfig = {
  sessionId: string; environment: string; hostId: string; roundId: string;
  participants: string[]; guesserId: string; controllerId?: string;
  initialReady?: string[];
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
);
export type RemoteView = {
  sessionId: string; roundId: string; revision: number; phase: RemotePhase;
  hostId: string; guesserId: string; controllerId: string; resumeOwnerId: string | null;
  mode?: GameMode;
  participants: string[]; ready: string[]; deck: DeckAgreement;
  durationSeconds: number;
  startsAt: number | null; deadline: number | null; remainingMs: number;
  score: number; canAnswer: boolean; cardNonce: string | null;
  card: RemoteCard | null; feedback: RemoteOutcome | null;
  resultReason: RemoteResultReason | null;
  results: (RemoteCard & { outcome: RemoteResultOutcome })[] | null;
  resultsViewingIds?: string[];
};
export type RecoveryCheckpoint = {
  version: 1; authorityRevision: number; checkpointId: string;
  sessionId: string; environment: string; roundId: string; revision: number;
  hostId: string; guesserId: string; controllerId: string; resumeOwnerId: string;
  participants: string[]; ready: string[]; mode: GameMode; durationSeconds: number;
  deck: DeckAgreement; cards: RemoteCard[]; index: number; remainingMs: number;
  outcomes: (RemoteCard & { outcome: RemoteResultOutcome })[]; acceptedCommands: string[];
};

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const checkpointCardFields = (value: unknown): value is RemoteCard => !!value && typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as RemoteCard).answer === 'string' && (value as RemoteCard).answer.length > 0 &&
  (value as RemoteCard).answer.length <= 256 && typeof (value as RemoteCard).byline === 'string' &&
  (value as RemoteCard).byline.length <= 256;

export function validateRecoveryCheckpoint(value: unknown): value is RecoveryCheckpoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['version', 'authorityRevision', 'checkpointId', 'sessionId', 'environment', 'roundId',
    'revision', 'hostId', 'guesserId', 'controllerId', 'resumeOwnerId', 'participants', 'ready',
    'mode', 'durationSeconds', 'deck', 'cards', 'index', 'remainingMs', 'outcomes', 'acceptedCommands'];
  const participants = Array.isArray(v.participants) ? v.participants : [];
  const deck = v.deck as Record<string, unknown> | null;
  return Object.keys(v).sort().join() === keys.sort().join() && v.version === 1 &&
    Number.isSafeInteger(v.authorityRevision) && (v.authorityRevision as number) >= 0 &&
    Number.isSafeInteger(v.revision) && (v.revision as number) >= 0 &&
    [v.checkpointId, v.sessionId, v.environment, v.roundId, v.hostId, v.guesserId,
      v.controllerId, v.resumeOwnerId].every(identifier) &&
    participants.length >= 2 && participants.length <= 32 && participants.every(identifier) &&
    new Set(participants).size === participants.length &&
    [v.hostId, v.guesserId, v.controllerId, v.resumeOwnerId].every((id) => participants.includes(id as string)) &&
    Array.isArray(v.ready) && v.ready.every((id) => identifier(id) && participants.includes(id)) &&
    new Set(v.ready).size === v.ready.length && ['classic', 'pass-n-play'].includes(String(v.mode)) &&
    Number.isInteger(v.durationSeconds) && (v.durationSeconds as number) >= MIN_ROUND_DURATION &&
    (v.durationSeconds as number) <= MAX_ROUND_DURATION && !!deck && !Array.isArray(deck) &&
    Object.keys(deck).sort().join() === 'contentHash,deckId,sponsorId' && identifier(deck.deckId) &&
    hash(deck.contentHash) && identifier(deck.sponsorId) && participants.includes(deck.sponsorId) &&
    Array.isArray(v.cards) && v.cards.length > 0 && v.cards.length <= 1000 && v.cards.every((item) =>
      checkpointCardFields(item) && Object.keys(item as Record<string, unknown>).sort().join() === 'answer,byline') &&
    Number.isInteger(v.index) && (v.index as number) >= 0 && (v.index as number) < v.cards.length &&
    Number.isFinite(v.remainingMs) && (v.remainingMs as number) >= 0 &&
    (v.remainingMs as number) <= (v.durationSeconds as number) * 1000 &&
    Array.isArray(v.outcomes) && v.outcomes.length === v.index && v.outcomes.every((item) =>
      checkpointCardFields(item) && ['correct', 'pass', 'neutral'].includes(String((item as Record<string, unknown>).outcome)) &&
      Object.keys(item as Record<string, unknown>).sort().join() === 'answer,byline,outcome') &&
    Array.isArray(v.acceptedCommands) && v.acceptedCommands.length <= 4096 &&
    v.acceptedCommands.every((key) => typeof key === 'string' &&
      /^[a-zA-Z0-9:_-]{1,128}\/[a-zA-Z0-9:_-]{1,128}$/.test(key)) &&
    new Set(v.acceptedCommands).size === v.acceptedCommands.length;
}

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
  private controllerId: string;
  private resumeOwnerId: string | null = null;
  private outcomes: (RemoteCard & { outcome: RemoteResultOutcome })[] = [];
  private lastNow = 0;
  private recovered = false;

  constructor(config: RemoteRoundConfig, private readonly nextNonce: () => string) {
    const ids = [config.sessionId, config.environment, config.hostId, config.roundId, ...config.participants];
    if (!ids.every(identifier) || config.participants.length < 2 ||
      new Set(config.participants).size !== config.participants.length ||
      ![config.hostId, config.guesserId, config.controllerId ?? config.guesserId, config.deck.sponsorId]
        .every((id) => config.participants.includes(id)) ||
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
    this.controllerId = config.controllerId ?? config.guesserId;
    this.members = [...config.participants];
    this.ready = new Set(config.initialReady?.filter((id) => this.members.includes(id)) ?? []);
    this.remainingMs = config.durationSeconds * 1000;
  }

  checkpoint(checkpointId: string, authorityRevision: number): RecoveryCheckpoint | null {
    if (this.phase !== 'paused' || !this.resumeOwnerId || !identifier(checkpointId) ||
      !Number.isSafeInteger(authorityRevision) || authorityRevision < 0) return null;
    return {
      version: 1, authorityRevision, checkpointId,
      sessionId: this.config.sessionId, environment: this.config.environment,
      roundId: this.config.roundId, revision: this.revision,
      hostId: this.config.hostId, guesserId: this.config.guesserId,
      controllerId: this.controllerId, resumeOwnerId: this.resumeOwnerId,
      participants: [...this.members], ready: [...this.ready], mode: this.config.mode ?? 'classic',
      durationSeconds: this.config.durationSeconds,
      deck: { ...this.config.deck }, cards: this.config.cards.map((card) => ({ ...card })),
      index: this.index, remainingMs: this.remainingMs,
      outcomes: this.outcomes.map((outcome) => ({ ...outcome })),
      acceptedCommands: [...this.accepted],
    };
  }

  static recover(checkpoint: RecoveryCheckpoint, successorId: string, participants: string[],
    now: number, nextNonce: () => string) {
    if (!validateRecoveryCheckpoint(checkpoint) || !identifier(successorId) ||
      !participants.includes(successorId) || !Number.isFinite(now) || now < 0) return null;
    const active = checkpoint.participants.filter((id) => participants.includes(id));
    if (!active.includes(successorId)) active.push(successorId);
    const round = new RemoteRound({
      sessionId: checkpoint.sessionId, environment: checkpoint.environment,
      hostId: checkpoint.hostId, roundId: checkpoint.roundId,
      participants: checkpoint.participants, guesserId: checkpoint.guesserId,
      controllerId: checkpoint.controllerId, mode: checkpoint.mode,
      durationSeconds: checkpoint.durationSeconds, deck: checkpoint.deck, cards: checkpoint.cards,
    }, nextNonce);
    round.config.hostId = successorId;
    round.members = active;
    round.config.guesserId = active.includes(checkpoint.guesserId) ? checkpoint.guesserId : successorId;
    round.controllerId = active.includes(checkpoint.controllerId) ? checkpoint.controllerId : successorId;
    round.resumeOwnerId = active.includes(checkpoint.resumeOwnerId) ? checkpoint.resumeOwnerId
      : active.includes(round.config.guesserId) ? round.config.guesserId : round.controllerId;
    round.ready = new Set(checkpoint.ready.filter((id) => active.includes(id)));
    round.accepted = new Set(checkpoint.acceptedCommands);
    round.revision = checkpoint.revision + 1;
    round.phase = 'paused'; round.index = checkpoint.index;
    round.remainingMs = checkpoint.remainingMs;
    round.outcomes = checkpoint.outcomes.map((outcome) => ({ ...outcome }));
    round.startsAt = null; round.deadline = null; round.nonce = null; round.lastNow = now;
    round.recovered = true;
    return round;
  }

  private finish(reason: RemoteResultReason) {
    if (reason === 'time' && this.phase === 'playing' && this.nonce !== null &&
      this.index < this.config.cards.length) {
      this.outcomes.push({ ...this.config.cards[this.index], outcome: 'neutral' });
    }
    this.phase = 'results'; this.resultReason = reason;
    // In Pass n Play a pass or unanswered card stays with its last clue giver.
    // A correct final card hands the next round to the following player.
    if (this.members.length >= 2 && (this.config.mode !== 'pass-n-play' ||
      this.outcomes.at(-1)?.outcome === 'correct')) this.rotateGuesser();
    this.nonce = null;
  }

  /** The next controller starts a fresh round without another ready cycle. */
  startNext(now: number) {
    if (this.phase !== 'lobby' || this.members.length < 2) return false;
    this.phase = 'countdown'; this.startsAt = now + 3000;
    this.deadline = this.startsAt + this.remainingMs;
    this.revision++;
    return true;
  }

  resetToLobby() {
    this.phase = 'lobby'; this.resultReason = null;
    this.resumeOwnerId = null;
    this.startsAt = null; this.deadline = null; this.nonce = null;
    this.remainingMs = this.config.durationSeconds * 1000;
    this.index = 0; this.outcomes = []; this.clearReadiness(); this.revision++;
  }

  /** Called with a monotonic host clock, including when no commands arrive. */
  tick(now: number) {
    if (!Number.isFinite(now) || now < this.lastNow) throw new Error('Host clock must be monotonic');
    this.lastNow = now;
    if (this.deadline !== null && now >= this.deadline && !['paused', 'results', 'ended'].includes(this.phase)) {
      this.finish('time'); this.remainingMs = 0; this.revision++;
    } else if (this.phase === 'countdown' && this.startsAt !== null && now >= this.startsAt) {
      this.phase = 'playing'; this.nonce = this.nextNonce(); this.revision++;
    } else if (this.phase === 'feedback' && now >= this.feedbackUntil) {
      if (this.pendingHandoff) this.rotateGuesser();
      this.pendingHandoff = false;
      this.phase = 'playing';
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
    // Lobby readiness is concurrent, and answers are guarded by the opaque card nonce.
    // A background pause must still succeed when the sender missed a snapshot.
    // Start, resume, and end controls require the exact current revision.
    if (!['ready', 'answer', 'pause'].includes(intent.kind) && intent.revision !== this.revision) return 'rejected';
    switch (intent.kind) {
      case 'ready':
        if (this.phase !== 'lobby' || intent.contentHash !== this.config.deck.contentHash ||
          intent.revision < this.readinessRevision || this.ready.has(senderId)) return 'rejected';
        this.ready.add(senderId);
        break;
      case 'start':
      case 'resume':
        if (senderId !== (intent.kind === 'start' ? this.config.guesserId : this.resumeOwnerId) ||
          this.phase !== (intent.kind === 'start' ? 'lobby' : 'paused') ||
          (this.members.length < 2 && !this.recovered) ||
          !this.members.includes(this.config.guesserId) ||
          (intent.kind === 'start' && !this.members.includes(this.config.deck.sponsorId))) return 'rejected';
        this.phase = 'countdown'; this.startsAt = now + 3000; this.deadline = this.startsAt + this.remainingMs;
        this.resumeOwnerId = null;
        break;
      case 'answer': {
        if (this.phase !== 'playing' || senderId !== this.config.guesserId || intent.cardNonce !== this.nonce) return 'rejected';
        this.outcomes.push({ answer: this.config.cards[this.index].answer,
          byline: this.config.cards[this.index].byline, outcome: intent.outcome });
        this.index++; this.nonce = null;
        this.phase = this.index === this.config.cards.length ? 'results' : 'feedback';
        if (this.phase === 'results') this.finish('cards');
        this.feedbackUntil = now + 600;
        this.pendingHandoff = this.config.mode === 'pass-n-play' && intent.outcome === 'correct';
        break;
      }
      case 'pause':
        if (!['countdown', 'playing', 'feedback'].includes(this.phase)) return 'rejected';
        this.pause(now, senderId);
        break;
      case 'end':
        if (senderId !== this.config.hostId) return 'rejected';
        this.phase = 'ended'; this.resumeOwnerId = null; this.nonce = null;
        break;
    }
    this.accepted.add(key); this.revision++;
    return 'accepted';
  }

  private pause(now: number, resumeOwnerId: string) {
    if (this.phase === 'feedback' && this.pendingHandoff) this.rotateGuesser();
    this.pendingHandoff = false;
    this.remainingMs = Math.max(0, (this.deadline ?? now) - Math.max(now, this.startsAt ?? now));
    this.phase = 'paused'; this.resumeOwnerId = resumeOwnerId;
    this.nonce = null; this.startsAt = null; this.deadline = null; this.clearReadiness();
  }

  private rotateGuesser() {
    const index = this.members.indexOf(this.config.guesserId);
    this.config.guesserId = this.members[(index + 1) % this.members.length];
  }

  setLobbyMode(mode: GameMode) {
    if (this.phase !== 'lobby' || !['classic', 'pass-n-play'].includes(mode) || mode === this.config.mode) return false;
    this.config.mode = mode; this.revision++;
    return true;
  }

  private clearReadiness() {
    this.ready.clear();
    // Concurrent ready taps may share a revision, but a pause requires fresh readiness.
    this.readinessRevision = this.revision + 1;
  }

  setLobbyDuration(seconds: number) {
    if (this.phase !== 'lobby' || !Number.isInteger(seconds) ||
      seconds < MIN_ROUND_DURATION || seconds > MAX_ROUND_DURATION ||
      seconds === this.config.durationSeconds) return false;
    this.config.durationSeconds = seconds;
    this.remainingMs = seconds * 1000;
    this.revision++;
    return true;
  }

  setLobbyGuesser(guesserId: string) {
    if (!['lobby', 'results'].includes(this.phase) || !this.members.includes(guesserId) ||
      guesserId === this.config.guesserId) return false;
    this.config.guesserId = guesserId;
    this.revision++;
    return true;
  }

  /** Membership must come from the native session. Active rounds keep running with at least two players. */
  removeParticipant(id: string, now: number) {
    this.tick(now);
    if (!this.members.includes(id)) return;
    const departingResumeOwner = id === this.resumeOwnerId && this.phase === 'paused';
    const departedIndex = this.members.indexOf(id);
    this.members = this.members.filter((member) => member !== id);
    this.ready.delete(id);
    if (departingResumeOwner) {
      this.resumeOwnerId = this.config.guesserId !== id && this.members.includes(this.config.guesserId)
        ? this.config.guesserId
        : this.members.includes(this.controllerId) ? this.controllerId : null;
    }
    if (this.members.length < 2) {
      this.phase = 'results'; this.resultReason = 'players'; this.remainingMs = 0;
      this.resumeOwnerId = null;
      this.startsAt = null; this.deadline = null; this.nonce = null;
    } else if (id === this.config.hostId) {
      // The fixed transport host cannot publish another authoritative view.
      this.phase = 'ended'; this.resumeOwnerId = null; this.nonce = null;
    } else if (id === this.config.guesserId) {
      // In Classic, a replacement guesser previously saw this answer.
      // In Pass n Play, a replacement clue giver was guessing and never saw it.
      this.config.guesserId = this.members[departedIndex % this.members.length];
      if (this.phase === 'playing') {
        if (this.config.mode !== 'pass-n-play') this.index++;
        if (this.index >= this.config.cards.length) {
          this.finish('cards'); this.remainingMs = 0;
          this.startsAt = null; this.deadline = null; this.nonce = null;
        } else this.nonce = this.nextNonce();
      }
    }
    this.revision++;
  }

  addParticipant(id: string, now: number) {
    this.tick(now);
    if (!identifier(id) || this.members.includes(id) ||
      ['results', 'ended'].includes(this.phase)) return;
    this.members.push(id);
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
      controllerId: this.controllerId, resumeOwnerId: this.resumeOwnerId,
      mode: this.config.mode,
      participants: [...this.members], ready: [...this.ready],
      durationSeconds: this.config.durationSeconds,
      deck: { deckId: this.config.deck.deckId, contentHash: this.config.deck.contentHash,
        sponsorId: this.config.deck.sponsorId },
      startsAt: this.startsAt, deadline: this.deadline,
      remainingMs: this.phase === 'results' ? 0 : this.deadline === null ? this.remainingMs : Math.max(0, this.deadline - Math.max(now, this.startsAt ?? now)),
      score: this.outcomes.filter((item) => item.outcome === 'correct').length,
      canAnswer: this.phase === 'playing' && recipient === this.config.guesserId,
      cardNonce: this.phase === 'playing' && recipient === this.config.guesserId ? this.nonce : null,
      card: canSeeCard ? { answer: this.config.cards[this.index].answer,
        byline: this.config.cards[this.index].byline } : null,
      feedback: this.phase === 'feedback' ? (this.outcomes.at(-1)?.outcome as RemoteOutcome | undefined) ?? null : null,
      resultReason: this.phase === 'results' ? this.resultReason : null,
      results: this.phase === 'results' ? this.outcomes.map((item) =>
        ({ answer: item.answer, byline: item.byline, outcome: item.outcome })) : null,
    };
  }
}
