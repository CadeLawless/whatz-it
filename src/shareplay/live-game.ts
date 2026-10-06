import type { SharePlayMessage, SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { RemoteClock } from './remote-clock';
import { parseProbe } from './connection-probe';
import { parseGameWire, parseRemoteView, type GameControl, type GameWire } from './game-wire';
import { RemoteRound, type RemoteCard, type RemoteIntent, type RemoteOutcome, type RemoteView } from './remote-round';
import { MAX_ROUND_DURATION, MIN_ROUND_DURATION } from '@/game/round-duration';
import type { GameMode } from '../game/game-types';

type Callbacks = {
  environment: string;
  uuid: () => string;
  digest: (text: string) => Promise<string>;
  send: (body: string, recipients: string[]) => Promise<void>;
  cards: (deckId: string) => RemoteCard[] | null | Promise<RemoteCard[] | null>;
  onCardSeen?: (card: RemoteCard) => void;
  availableDeckIds: () => string[];
  onDecks: (selectedDeckId: string | null, availableDeckIds: string[], durationSeconds: number, mode: GameMode) => void;
  onView: (view: RemoteView | null) => void;
  onError: (message: string) => void;
  onActive: (phase: RemoteView['phase']) => void;
  onLobby: () => void;
  onHostClaim?: (participantId: string, signed: boolean, term: number) => void;
  onHostTransfer?: (participantId: string, term: number) => void;
  onHostActivity?: () => void;
  onSessionEnd?: () => void;
  onEndGame?: () => void;
  trace?: (stage: string, details?: Record<string, string | number | boolean | null>, warning?: boolean) => void;
};

/** Session-scoped transport owner. Only the native session provides sender identity. */
export class LiveGame {
  private session: SharePlaySnapshot | null = null;
  private round: RemoteRound | null = null;
  private view: RemoteView | null = null;
  private clock = new RemoteClock();
  private nonce = 0;
  private generation = 0;
  private preparing = false;
  private lastSnapshotAt = 0;
  private lastHostTime = -1;
  private lastViewHostTime = -1;
  private lastSelectionHostTime = -1;
  private lastPublishAt = 0;
  private lastClockAt = 0;
  private lastInventoryRequestAt = new Map<string, number>();
  private guesserId: string | null = null;
  private savedReady: string[] = [];
  private autoStartNext = false;
  private selectedDeckId: string | null = null;
  private selectionCleared = false;
  private selectedDurationSeconds = 60;
  private selectedMode: GameMode = 'classic';
  private inventories = new Map<string, Set<string>>();
  private inventoryParts = new Map<string, { generation: string; total: number; parts: Map<number, string[]> }>();
  private pendingDeckRequest: { id: string; sponsorId: string; deckId: string } | null = null;
  private foreground = true;
  private lastReply = new Map<string, number>();
  private lastHostClaimAt = 0;
  private rememberedCards = new Set<string>();

  constructor(private callbacks: Callbacks) {}

  get currentView() { return this.view; }
  get isForeground() { return this.foreground; }
  get hostNow() {
    if (this.session?.isHost) return performance.now();
    return this.clock.hostNow(performance.now());
  }
  get synchronized() {
    if (!this.session || this.session.status !== 'joined' || !this.foreground) return false;
    if (this.session.isHost) return true;
    return this.hostNow !== null && performance.now() - this.lastSnapshotAt < 6_000;
  }
  private get displayHostNow() {
    return this.hostNow ?? (this.lastHostTime >= 0 && this.lastSnapshotAt > 0
      ? this.lastHostTime + Math.max(0, performance.now() - this.lastSnapshotAt) : null);
  }
  get remainingMs() {
    if (!this.view) return 0;
    const now = this.displayHostNow;
    if (this.view.deadline === null || now === null) return this.view.remainingMs;
    return Math.max(0, this.view.deadline - Math.max(now, this.view.startsAt ?? now));
  }
  get countdown() {
    const now = this.displayHostNow;
    if (this.view?.phase !== 'countdown' || this.view.startsAt === null || now === null) return 0;
    return Math.max(0, Math.ceil((this.view.startsAt - now) / 1000));
  }

  setForeground(active: boolean) {
    if (this.foreground !== active) this.callbacks.trace?.('game.foreground', { foreground: active });
    this.foreground = active;
    if (!active) {
      if (this.view && this.view.guesserId === this.session?.localParticipantId &&
        ['countdown', 'playing', 'feedback'].includes(this.view.phase)) this.act('pause');
      // Drop all received answer data while the app is in the app switcher.
      if (!this.session?.isHost) this.setView(null);
      this.clock.reset();
    } else if (this.session?.status === 'joined') {
      if (this.session.isHost) this.publish();
      else {
        this.requestSnapshot();
        this.requestClock();
      }
    }
  }

  setSession(next: SharePlaySnapshot) {
    const old = this.session;
    if (next.sessionId !== old?.sessionId || next.status !== old?.status ||
      next.participantIds.join() !== old?.participantIds.join() || next.isHost !== old?.isHost) {
      this.callbacks.trace?.('game.session', { status: next.status, isHost: next.isHost,
        members: next.participantIds.length, session: next.sessionId?.slice(-8) ?? 'none' });
    }
    if (next.sessionId !== old?.sessionId) {
      this.generation++;
      this.rememberedCards.clear();
      this.round = null; this.guesserId = null; this.savedReady = []; this.autoStartNext = false; this.clock.reset();
      this.inventories.clear(); this.inventoryParts.clear(); this.pendingDeckRequest = null;
      this.selectedDeckId = next.activity?.deckId ?? null;
      this.selectionCleared = false;
      this.selectedDurationSeconds = next.activity?.durationSeconds ?? 60;
      this.selectedMode = 'classic';
      this.reportDecks();
      this.lastReply.clear();
      this.lastInventoryRequestAt.clear();
      this.lastSnapshotAt = 0; this.lastHostTime = -1;
      this.lastViewHostTime = -1; this.lastSelectionHostTime = -1; this.setView(null);
    } else if (old && (next.hostParticipantId !== old.hostParticipantId || next.hostTerm !== old.hostTerm)) {
      // The former host's hidden card order and clock cannot be reconstructed
      // from guest views. Start a fresh lobby under the elected host.
      this.generation++;
      this.round = null; this.pendingDeckRequest = null; this.guesserId = null;
      this.clock.reset(); this.lastSnapshotAt = 0; this.lastHostTime = -1;
      this.lastViewHostTime = -1; this.lastSelectionHostTime = -1;
      this.setView(null);
      if (old.hostParticipantId) this.callbacks.onLobby();
    }
    this.session = next;
    for (const id of this.inventories.keys()) if (!next.participantIds.includes(id)) {
      this.inventories.delete(id);
      this.inventoryParts.delete(id);
      this.lastInventoryRequestAt.delete(id);
    }
    if (next.isHost && next.status === 'joined' &&
      (old?.hostParticipantId !== next.hostParticipantId || old?.hostTerm !== next.hostTerm || old?.status !== 'joined' ||
        old.participantIds.join() !== next.participantIds.join())) this.announceHost(performance.now());
    this.refreshAvailableDecks();
    if (next.status !== 'joined' || !next.sessionId || !next.localParticipantId) {
      if (next.status === 'ended' || next.status === 'idle') {
        this.round = null; this.setView(null);
      }
      return;
    }
    if (next.isHost) {
      const members = next.participantIds;
      if (this.pendingDeckRequest && !members.includes(this.pendingDeckRequest.sponsorId)) this.pendingDeckRequest = null;
      this.reportDecks();
      this.clearUnavailableSelection();
      this.requestMissingInventories(performance.now());
      if (this.round && this.view) {
        const departed = this.view.participants.filter((id) => !members.includes(id));
        const arrived = members.filter((id) => !this.view!.participants.includes(id));
        if ((this.view.phase === 'lobby' && this.selectedDeckId !== null &&
          (departed.length > 0 || arrived.length > 0)) ||
          (['results', 'ended'].includes(this.view.phase) && arrived.length > 0)) {
          this.saveLobbyReady(); this.round = null; this.setView(null); void this.prepare();
        } else {
          for (const member of departed) this.round.removeParticipant(member, performance.now());
          for (const member of arrived) this.round.addParticipant(member, performance.now());
          this.publish();
        }
      } else if (members.length >= 2) {
        void this.prepare();
      }
    } else if (old?.status !== 'joined' || next.participantIds.join() !== old.participantIds.join() ||
      next.hostParticipantId !== old.hostParticipantId || next.hostTerm !== old.hostTerm) {
      this.requestSnapshot();
      this.requestClock();
      this.sendInventory();
    }
  }

  private setView(view: RemoteView | null) {
    const previous = this.view;
    if (view && (view.phase !== previous?.phase || view.revision !== previous?.revision)) {
      this.callbacks.trace?.('game.view', { phase: view.phase, revision: view.revision,
        ready: view.ready.length, members: view.participants.length, isHost: !!this.session?.isHost,
        synchronized: this.synchronized });
    }
    this.view = view;
    if (view) {
      const seen = [view.card, ...(view.results ?? [])];
      for (const card of seen) {
        if (!card) continue;
        const key = JSON.stringify([view.sessionId, view.roundId, card.answer, card.byline]);
        if (this.rememberedCards.has(key)) continue;
        this.rememberedCards.add(key);
        this.callbacks.onCardSeen?.(card);
      }
    }
    if (view && this.session?.isHost) this.guesserId = view.guesserId;
    this.callbacks.onView(view);
    if (view && !this.session?.isHost && !this.selectionCleared) {
      this.selectionCleared = false;
      this.selectedDeckId = view.deck.deckId;
      this.selectedDurationSeconds = view.durationSeconds;
      this.selectedMode = view.mode ?? 'classic';
      this.reportDecks();
    }
    if (view?.phase === 'lobby' && previous && previous.phase !== 'lobby') this.callbacks.onLobby();
    if (view && ['countdown', 'playing', 'feedback', 'paused', 'results'].includes(view.phase)) this.callbacks.onActive(view.phase);
  }

  private send(message: GameWire, recipients: string[]) {
    if (!recipients.length) return;
    const body = JSON.stringify(message);
    if (encodeURIComponent(body).replace(/%[0-9A-F]{2}/gi, 'x').length > 16_384) {
      this.callbacks.trace?.('wire.oversize', { kind: message.kind, bytes: body.length }, true);
      this.callbacks.onError('This round has too much result text to send. Please start a new round.');
      return;
    }
    if (!['view', 'clock', 'clock-reply', 'snapshot-request', 'host-claim'].includes(message.kind))
      this.callbacks.trace?.('wire.send', { kind: message.kind, bytes: body.length, recipients: recipients.length });
    void this.callbacks.send(body, recipients).catch(() => {
      this.callbacks.trace?.('wire.send-failed', { kind: message.kind, recipients: recipients.length }, true);
      this.callbacks.onError('A SharePlay message did not send. Check the connection and try again.');
    });
  }

  private announceHost(now: number) {
    const session = this.session;
    if (!session?.isHost || !session.localParticipantId) return;
    const others = session.participantIds.filter((id) => id !== session.localParticipantId);
    if (!others.length) return;
    this.lastHostClaimAt = now;
    this.send({ version: 3, kind: 'host-claim', term: session.hostTerm ?? 0 }, others);
  }

  refreshAvailableDecks() {
    const session = this.session;
    if (session?.status !== 'joined' || !session.localParticipantId) return;
    const deckIds = this.callbacks.availableDeckIds().filter((id) => /^[a-zA-Z0-9:_-]{1,128}$/.test(id)).sort();
    const previous = this.inventories.get(session.localParticipantId);
    if (previous && deckIds.join() === [...previous].sort().join()) return;
    this.inventories.set(session.localParticipantId, new Set(deckIds));
    this.callbacks.trace?.('inventory.local', { deckCount: deckIds.length, isHost: session.isHost });
    this.reportDecks();
    if (session.isHost) this.clearUnavailableSelection();
    if (session.isHost) void this.prepare();
    else this.sendInventory();
  }

  private reportDecks() {
    const available = [...new Set([...this.inventories.values()].flatMap((ids) => [...ids]))].sort();
    this.callbacks.onDecks(this.selectedDeckId, available, this.selectedDurationSeconds, this.selectedMode);
  }

  private sendDeckSelection(recipients: string[]) {
    this.send({ version: 3, kind: 'deck-selection', deckId: this.selectedDeckId,
      durationSeconds: this.selectedDurationSeconds, mode: this.selectedMode, hostTime: performance.now(),
      inLobby: !this.round || this.view?.phase === 'lobby' }, recipients);
  }

  private clearUnavailableSelection() {
    const session = this.session;
    const deckId = this.selectedDeckId;
    if (!session?.isHost || !deckId ||
      !session.participantIds.every((id) => this.inventories.has(id)) ||
      session.participantIds.some((id) => this.inventories.get(id)?.has(deckId))) return;
    this.selectedDeckId = null;
    this.selectionCleared = true;
    this.generation++;
    this.pendingDeckRequest = null;
    // Keep the lobby view so its current controller can choose another deck.
    this.callbacks.trace?.('deck.selection-cleared', { code: 'no-connected-owner' });
    this.reportDecks();
    this.sendDeckSelection(session.participantIds.filter((id) => id !== session.localParticipantId));
  }

  private sendInventory() {
    const session = this.session;
    if (!session || session.isHost || !session.hostParticipantId || session.status !== 'joined' ||
      !session.localParticipantId) return;
    const ids = [...(this.inventories.get(session.localParticipantId) ?? [])].sort();
    if (ids.length > 1600) { this.callbacks.onError('Too many decks to share in this session.'); return; }
    const total = Math.max(1, Math.ceil(ids.length / 80));
    this.callbacks.trace?.('inventory.send', { deckCount: ids.length, parts: total });
    const generation = this.callbacks.uuid();
    for (let index = 0; index < total; index++) this.send({ version: 3, kind: 'inventory',
      generation, index, total, deckIds: ids.slice(index * 80, (index + 1) * 80) }, [session.hostParticipantId]);
  }

  private requestMissingInventories(now: number) {
    const session = this.session;
    if (!session?.isHost || session.status !== 'joined') return;
    for (const id of session.participantIds) {
      if (id === session.localParticipantId || this.inventories.has(id) ||
        now - (this.lastInventoryRequestAt.get(id) ?? -Infinity) < 2_000) continue;
      this.lastInventoryRequestAt.set(id, now);
      this.callbacks.trace?.('inventory.request', { participant: id.slice(-8) });
      this.send({ version: 3, kind: 'inventory-request' }, [id]);
    }
  }

  private shuffledRound(cards: RemoteCard[]) {
    const shuffled = cards.filter((card) => !!card.answer.trim() && card.answer.length <= 256 &&
      card.byline.length <= 256).map((card) => ({ answer: card.answer, byline: card.byline }));
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled.slice(0, 20);
  }

  private saveLobbyReady() {
    if (this.view?.phase === 'lobby') this.savedReady = [...this.view.ready];
  }

  private async prepare() {
    const current = this.session;
    const deckId = this.selectedDeckId;
    if (this.round || this.preparing || this.pendingDeckRequest || !current?.isHost || current.status !== 'joined' ||
      !current.activity || !current.localParticipantId || !deckId || current.participantIds.length < 2) return;
    const sponsorId = this.inventories.get(current.localParticipantId)?.has(deckId)
      ? current.localParticipantId
      : current.participantIds.find((id) => this.inventories.get(id)?.has(deckId));
    if (!sponsorId) {
      this.clearUnavailableSelection();
      return;
    }
    this.callbacks.trace?.('deck.sponsor', { participant: sponsorId.slice(-8),
      isHost: sponsorId === current.localParticipantId });
    if (sponsorId !== current.localParticipantId) {
      const id = this.callbacks.uuid();
      this.pendingDeckRequest = { id, sponsorId, deckId };
      this.lastReply.set(`request:${id}`, performance.now());
      this.send({ version: 3, kind: 'deck-request', requestId: id, deckId }, [sponsorId]);
      return;
    }
    this.preparing = true;
    const generation = ++this.generation;
    try {
      const cards = await this.callbacks.cards(deckId);
      if (!cards?.length) { this.callbacks.trace?.('deck.no-cards', {}, true); return; }
      const selected = this.shuffledRound(cards);
      if (!selected.length) return;
      const contentHash = await this.callbacks.digest(JSON.stringify(selected));
      if (generation === this.generation && this.session?.sessionId === current.sessionId &&
        this.session.participantIds.join() === current.participantIds.join() &&
        this.selectedDeckId === deckId) this.buildRound(selected, contentHash, sponsorId);
    } catch { this.callbacks.trace?.('deck.prepare-failed', {}, true);
      this.callbacks.onError('Could not prepare the shared deck.'); }
    finally {
      this.preparing = false;
      if (!this.round && this.session?.isHost && this.selectedDeckId !== deckId) void this.prepare();
    }
  }

  private buildRound(cards: RemoteCard[], contentHash: string, sponsorId: string) {
    const current = this.session;
    const deckId = this.selectedDeckId;
    if (!current?.isHost || current.status !== 'joined' || !current.localParticipantId ||
      !current.sessionId || !current.activity || !deckId || cards.length < 1 ||
      !current.participantIds.includes(sponsorId) || current.participantIds.length < 2) return;
    const players = current.participantIds;
    const guesserId = this.guesserId && players.includes(this.guesserId)
      ? this.guesserId : current.localParticipantId;
    this.round = new RemoteRound({
      sessionId: current.sessionId, environment: this.callbacks.environment,
      hostId: current.localParticipantId, roundId: this.callbacks.uuid(), participants: players,
      guesserId, initialReady: this.savedReady, durationSeconds: this.selectedDurationSeconds, mode: this.selectedMode,
      deck: { deckId, contentHash, sponsorId }, cards,
    }, () => `card-${++this.nonce}-${this.callbacks.uuid()}`);
    this.guesserId = guesserId;
    this.savedReady = [];
    if (this.autoStartNext) {
      this.round.startNext(performance.now());
      this.autoStartNext = false;
    }
    this.callbacks.trace?.('round.created', { members: players.length, deckCount: cards.length,
      participant: guesserId.slice(-8) });
    this.publish();
  }

  private publish() {
    const session = this.session;
    if (!this.round || !session?.isHost || session.status !== 'joined' || !session.localParticipantId) return;
    const now = performance.now();
    const local = this.round.viewFor(session.localParticipantId, now);
    if (!local) return;
    this.setView(local);
    this.lastPublishAt = now;
    for (const id of local.participants) {
      if (id === session.localParticipantId) continue;
      const view = this.round.viewFor(id, now);
      if (view) this.send({ version: 3, kind: 'view', view, hostTime: now }, [id]);
    }
  }

  receive(message: SharePlayMessage) {
    const session = this.session;
    if (!session?.sessionId || session.status !== 'joined' || message.sessionId !== session.sessionId ||
      !session.participantIds.includes(message.senderId) || !session.localParticipantId) {
      this.callbacks.trace?.('wire.dropped', { code: 'session-or-sender' }, true); return;
    }
    const wire = parseGameWire(message.body);
    if (!wire) {
      if (!parseProbe(message.body, this.callbacks.environment))
        this.callbacks.trace?.('wire.dropped', { code: 'invalid-game-wire', bytes: message.body.length }, true);
      return;
    }
    if (!['view', 'clock', 'clock-reply', 'snapshot-request', 'host-claim'].includes(wire.kind))
      this.callbacks.trace?.('wire.received', { kind: wire.kind, participant: message.senderId.slice(-8),
        isHost: message.senderIsHost, bytes: message.body.length });
    const now = performance.now();
    if (wire.kind === 'host-claim') {
      this.callbacks.onHostClaim?.(message.senderId, message.senderIsHost, wire.term ?? 0);
      return;
    }
    const fromHost = message.senderId === session.hostParticipantId &&
      (message.senderIsHost || session.electedHost === true);
    if (fromHost) this.callbacks.onHostActivity?.();
    if (wire.kind === 'session-end') {
      if (fromHost && wire.term === (session.hostTerm ?? 0)) this.callbacks.onSessionEnd?.();
      return;
    }
    if (wire.kind === 'deck-selection') {
      if (session.isHost || !fromHost || wire.hostTime < this.lastHostTime) return;
      this.lastHostTime = wire.hostTime;
      this.lastSelectionHostTime = wire.hostTime;
      this.selectedDeckId = wire.deckId;
      this.selectionCleared = wire.deckId === null;
      this.selectedDurationSeconds = wire.durationSeconds;
      this.selectedMode = wire.mode ?? 'classic';
      if (wire.deckId === null && wire.inLobby && this.view?.phase !== 'lobby') {
        const wasInRound = !!this.view;
        this.setView(null);
        if (wasInRound) this.callbacks.onLobby();
      }
      this.reportDecks();
      return;
    }
    if (wire.kind === 'host-transfer') {
      if (fromHost && wire.targetId !== message.senderId &&
        session.participantIds.includes(wire.targetId))
        this.callbacks.onHostTransfer?.(wire.targetId, wire.term ?? (session.hostTerm ?? 0) + 1);
      return;
    }
    if (wire.kind === 'view') {
      if (session.isHost || !fromHost) return;
      const view = parseRemoteView(wire.view, session.sessionId, session.localParticipantId);
      if (!view || view.hostId !== message.senderId ||
        wire.hostTime < this.lastViewHostTime ||
        (wire.hostTime < this.lastSelectionHostTime && this.selectedDeckId !== null &&
          view.deck.deckId !== this.selectedDeckId) ||
        (this.view && view.roundId === this.view.roundId && view.revision < this.view.revision) ||
        (this.view && view.roundId !== this.view.roundId && view.phase !== 'lobby' &&
          !['lobby', 'paused', 'results', 'ended'].includes(this.view.phase))) {
        this.callbacks.trace?.('view.rejected', { code: !view ? 'invalid-view' : 'stale-or-wrong-host' }, true); return;
      }
      this.lastSnapshotAt = now;
      this.lastViewHostTime = wire.hostTime;
      this.lastHostTime = Math.max(this.lastHostTime, wire.hostTime);
      if (this.foreground) this.setView(view);
      return;
    }
    if (wire.kind === 'intent') {
      if (!session.isHost || !this.round) return;
      const result = this.round.receive(message.senderId, JSON.stringify(wire.intent), now);
      this.callbacks.trace?.('intent.result', { kind: wire.intent.kind, result,
        participant: message.senderId.slice(-8) }, result === 'rejected');
      if (result !== 'rejected') this.publish();
      return;
    }
    if (wire.kind === 'control') {
      if (session.isHost) this.applyControl(message.senderId, wire);
      return;
    }
    if (wire.kind === 'inventory-request') {
      if (!session.isHost && fromHost) this.sendInventory();
      return;
    }
    if (wire.kind === 'inventory') {
      if (!session.isHost || message.senderId === session.localParticipantId) return;
      let assembly = this.inventoryParts.get(message.senderId);
      if (!assembly || assembly.generation !== wire.generation) {
        assembly = { generation: wire.generation, total: wire.total, parts: new Map() };
        this.inventoryParts.set(message.senderId, assembly);
      }
      if (assembly.total !== wire.total) return;
      assembly.parts.set(wire.index, wire.deckIds);
      if (assembly.parts.size !== assembly.total) return;
      const deckIds = Array.from({ length: assembly.total }, (_, index) => assembly.parts.get(index) ?? []).flat();
      this.inventories.set(message.senderId, new Set(deckIds));
      this.callbacks.trace?.('inventory.received', { participant: message.senderId.slice(-8),
        deckCount: deckIds.length, parts: assembly.total });
      this.inventoryParts.delete(message.senderId);
      this.reportDecks();
      this.clearUnavailableSelection();
      if (!this.round) void this.prepare();
      return;
    }
    if (wire.kind === 'deck-request') {
      if (session.isHost || !fromHost ||
        !this.inventories.get(session.localParticipantId)?.has(wire.deckId)) return;
      const key = `${message.senderId}:deck:${wire.requestId}`;
      if (this.lastReply.has(key)) return;
      this.lastReply.set(key, now);
      void Promise.resolve(this.callbacks.cards(wire.deckId)).then((cards) => {
        if (!cards?.length) return null;
        const selected = this.shuffledRound(cards);
        if (!selected.length) return null;
        return this.callbacks.digest(JSON.stringify(selected)).then((contentHash) => ({ selected, contentHash }));
      }).then((prepared) => {
        if (!prepared) return;
        const { selected, contentHash } = prepared;
        if (this.session?.sessionId === session.sessionId && this.session.status === 'joined' &&
          this.inventories.get(session.localParticipantId!)?.has(wire.deckId)) {
          this.send({ version: 3, kind: 'deck-cards', requestId: wire.requestId,
            deckId: wire.deckId, contentHash, cards: selected }, [message.senderId]);
        }
      }).catch(() => this.callbacks.onError('Could not prepare that deck for SharePlay.'));
      return;
    }
    if (wire.kind === 'deck-cards') {
      const pending = this.pendingDeckRequest;
      if (!session.isHost || !pending || pending.id !== wire.requestId ||
        pending.sponsorId !== message.senderId || pending.deckId !== wire.deckId ||
        this.selectedDeckId !== wire.deckId || !this.inventories.get(message.senderId)?.has(wire.deckId)) return;
      void this.callbacks.digest(JSON.stringify(wire.cards)).then((actualHash) => {
        if (this.pendingDeckRequest?.id !== wire.requestId || this.session?.sessionId !== session.sessionId) return;
        this.pendingDeckRequest = null;
        if (actualHash !== wire.contentHash) {
          this.callbacks.trace?.('deck.hash-mismatch', { participant: message.senderId.slice(-8) }, true);
          this.callbacks.onError('The shared deck did not pass its content check. Choose another deck.');
          return;
        }
        this.buildRound(wire.cards, actualHash, message.senderId);
      }).catch(() => {
        this.pendingDeckRequest = null;
        this.callbacks.onError('Could not verify the shared deck.');
      });
      return;
    }
    if (wire.kind === 'snapshot-request') {
      if (!session.isHost) return;
      const key = `${message.senderId}:view`;
      if (now - (this.lastReply.get(key) ?? -Infinity) < 250) return;
      this.lastReply.set(key, now);
      const view = this.round?.viewFor(message.senderId, now);
      if (view) this.send({ version: 3, kind: 'view', view, hostTime: now }, [message.senderId]);
      this.sendDeckSelection([message.senderId]);
      return;
    }
    if (wire.kind === 'clock') {
      if (!session.isHost) return;
      const key = `${message.senderId}:clock`;
      if (now - (this.lastReply.get(key) ?? -Infinity) < 250) return;
      this.lastReply.set(key, now);
      this.send({ version: 3, kind: 'clock-reply', nonce: wire.nonce, received: now,
        sent: performance.now() }, [message.senderId]);
      return;
    }
    if (wire.kind === 'clock-reply' && !session.isHost && fromHost) {
      const wasSynchronized = this.synchronized;
      const accepted = this.clock.reply(wire.nonce, wire.received, wire.sent, now);
      if (!accepted || wasSynchronized !== this.synchronized)
        this.callbacks.trace?.('clock.reply', { accepted, synchronized: this.synchronized }, !accepted);
    }
  }

  private requestSnapshot() {
    const session = this.session;
    if (!session || session.isHost || !session.hostParticipantId) return;
    this.send({ version: 3, kind: 'snapshot-request' }, [session.hostParticipantId]);
  }

  private requestClock() {
    const session = this.session;
    if (!session || session.isHost || !session.hostParticipantId) return;
    const nonce = this.callbacks.uuid();
    if (!this.clock.begin(nonce, performance.now())) return;
    this.lastClockAt = performance.now();
    this.send({ version: 3, kind: 'clock', nonce }, [session.hostParticipantId]);
  }

  pulse() {
    const session = this.session;
    // A clue-giving host must keep publishing while its JS runtime is available.
    // Backgrounding changes local presentation, not the shared round timeline.
    if (!session || session.status !== 'joined' || (!this.foreground && !session.isHost)) return;
    const now = performance.now();
    if (session.isHost && now - this.lastHostClaimAt > 2_000) this.announceHost(now);
    if (session.isHost) this.requestMissingInventories(now);
    if (session.isHost && this.pendingDeckRequest && now - (this.lastReply.get(`request:${this.pendingDeckRequest.id}`) ?? now) > 10_000) {
      this.callbacks.trace?.('deck.request-timeout', {}, true);
      this.pendingDeckRequest = null;
      this.callbacks.onError('The deck owner did not respond. Choose the deck again or try another.');
    }
    if (session.isHost && this.round) {
      const before = this.view?.revision;
      this.round.tick(now);
      const current = this.round.viewFor(session.localParticipantId!, now);
      if (current && (current.revision !== before || now - this.lastPublishAt > 2_000)) this.publish();
    } else if (!session.isHost && session.hostParticipantId) {
      if (now - this.lastClockAt > (this.hostNow === null ? 1_000 : 10_000)) this.requestClock();
      if (now - this.lastSnapshotAt > 3_000 && now - this.lastPublishAt > 3_000) {
        this.lastPublishAt = now;
        this.requestSnapshot();
      }
    }
  }

  act(kind: 'ready' | 'start' | 'pause' | 'resume' | 'end' | 'answer', outcome?: RemoteOutcome) {
    const session = this.session;
    const view = this.view;
    if (!session || session.status !== 'joined' || !session.localParticipantId || !view) {
      this.callbacks.trace?.('action.blocked', { kind, code: 'no-session-or-view' }, true); return;
    }
    if (kind !== 'pause' && !this.foreground) return;
    if (kind === 'answer' && (!view.canAnswer || !view.cardNonce)) {
      this.callbacks.trace?.('action.blocked', { kind, code: 'not-authorized' }, true); return;
    }
    this.callbacks.trace?.('action.request', { kind, phase: view.phase, revision: view.revision,
      isHost: session.isHost });
    const base = { protocol: 1 as const, sessionId: session.sessionId!,
      environment: this.callbacks.environment, roundId: view.roundId,
      intentId: this.callbacks.uuid(), revision: view.revision };
    const intent: RemoteIntent = kind === 'ready' ? { ...base, kind, contentHash: view.deck.contentHash }
      : kind === 'answer' ? { ...base, kind, cardNonce: view.cardNonce!, outcome: outcome! }
        : { ...base, kind };
    if (session.isHost && this.round) {
      const result = this.round.receive(session.localParticipantId, JSON.stringify(intent), performance.now());
      this.callbacks.trace?.('action.result', { kind, result }, result === 'rejected');
      if (result === 'accepted') this.publish();
    } else if (session.hostParticipantId) this.send({ version: 3, kind: 'intent', intent }, [session.hostParticipantId]);
  }

  selectGuesser(guesserId: string) {
    this.requestControl({ action: 'select-guesser', participantId: guesserId });
  }

  selectDeck(deckId: string) {
    this.requestControl({ action: 'select-deck', deckId });
  }

  selectMode(mode: GameMode) {
    this.requestControl({ action: 'select-mode', mode });
  }

  selectDuration(seconds: number) {
    this.requestControl({ action: 'select-duration', seconds });
  }

  returnToLobby() {
    this.requestControl({ action: 'return-to-lobby' });
  }

  nextRound() {
    this.requestControl({ action: 'next-round' });
  }

  endGame() {
    this.requestControl({ action: 'end-game' });
  }

  private requestControl(action: GameControl) {
    const session = this.session;
    if (!session || session.status !== 'joined' || !session.localParticipantId || !this.view ||
      this.view.guesserId !== session.localParticipantId) return;
    const control = { version: 3 as const, kind: 'control' as const,
      roundId: this.view.roundId, revision: this.view.revision, ...action };
    if (session.isHost) this.applyControl(session.localParticipantId, control);
    else if (session.hostParticipantId) this.send(control, [session.hostParticipantId]);
  }

  private applyControl(senderId: string, control: Extract<GameWire, { kind: 'control' }>) {
    const session = this.session;
    const view = this.view;
    if (!session?.isHost || !view || control.roundId !== view.roundId ||
      control.revision !== view.revision || senderId !== view.guesserId ||
      !session.participantIds.includes(senderId)) return;
    const lobby = view.phase === 'lobby';
    if (control.action === 'select-guesser') {
      if (!(lobby || view.phase === 'results') || !session.participantIds.includes(control.participantId) ||
        control.participantId === view.guesserId) return;
      this.guesserId = control.participantId;
      if (this.round?.setLobbyGuesser(control.participantId)) this.publish();
      return;
    }
    if (control.action === 'select-deck') {
      if (!lobby || ![...this.inventories.values()].some((ids) => ids.has(control.deckId)) ||
        control.deckId === this.selectedDeckId) return;
      this.saveLobbyReady();
      this.selectedDeckId = control.deckId; this.selectionCleared = false;
      this.pendingDeckRequest = null; this.round = null; this.setView(null);
      this.reportDecks(); this.sendDeckSelection(session.participantIds.filter((id) => id !== session.localParticipantId));
      void this.prepare();
      return;
    }
    if (control.action === 'select-mode') {
      if (!lobby || control.mode === this.selectedMode) return;
      this.selectedMode = control.mode; this.reportDecks();
      this.sendDeckSelection(session.participantIds.filter((id) => id !== session.localParticipantId));
      if (this.round?.setLobbyMode(control.mode)) this.publish();
      return;
    }
    if (control.action === 'select-duration') {
      if (!lobby || control.seconds === this.selectedDurationSeconds ||
        control.seconds < MIN_ROUND_DURATION || control.seconds > MAX_ROUND_DURATION) return;
      this.selectedDurationSeconds = control.seconds; this.reportDecks();
      if (this.round?.setLobbyDuration(control.seconds)) this.publish();
      return;
    }
    if (control.action === 'next-round') {
      if (view.phase !== 'results' || session.participantIds.length < 2) return;
      this.guesserId = view.guesserId;
      this.savedReady = []; this.autoStartNext = true;
      this.pendingDeckRequest = null; this.round = null; this.setView(null); void this.prepare();
      return;
    }
    if (control.action === 'return-to-lobby') {
      if (lobby) return;
      this.savedReady = []; this.autoStartNext = false;
      if (this.selectedDeckId === null && this.round) {
        this.round.resetToLobby(); this.publish(); return;
      }
      this.round = null; this.pendingDeckRequest = null;
      this.guesserId = view.guesserId;
      this.setView(null); void this.prepare();
      this.sendDeckSelection(session.participantIds.filter((id) => id !== session.localParticipantId));
      return;
    }
    if (control.action === 'end-game') this.callbacks.onEndGame?.();
  }

  async endSession(): Promise<void> {
    const session = this.session;
    if (!session?.isHost || session.status !== 'joined') throw new Error('SharePlay: notHost');
    const recipients = session.participantIds.filter((id) => id !== session.localParticipantId);
    if (recipients.length) await this.callbacks.send(JSON.stringify({ version: 3,
      kind: 'session-end', term: session.hostTerm ?? 0 }), recipients);
  }

  async transferHost(participantId: string, automatic = false): Promise<boolean> {
    const session = this.session;
    if (!session?.isHost || session.status !== 'joined' || !session.localParticipantId ||
      (this.view && (automatic ? !['lobby', 'paused', 'results', 'ended'].includes(this.view.phase)
        : this.view.phase !== 'lobby')) ||
      participantId === session.localParticipantId ||
      !session.participantIds.includes(participantId)) return false;
    const recipients = session.participantIds.filter((id) => id !== session.localParticipantId);
    const term = (session.hostTerm ?? 0) + 1;
    await this.callbacks.send(JSON.stringify({ version: 3, kind: 'host-transfer', targetId: participantId, term }), recipients);
    this.callbacks.onHostTransfer?.(participantId, term);
    return true;
  }
}
