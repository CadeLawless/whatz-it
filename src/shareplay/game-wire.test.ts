import assert from 'node:assert/strict';
import test from 'node:test';
import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { parseGameWire, parseRemoteView } from './game-wire';
import { LiveGame } from './live-game';
import { resolveSharePlayHost } from './host-election';
import { RemoteRound, type RemoteView } from './remote-round';

const hash = 'a'.repeat(64);
const round = new RemoteRound({
  sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'round',
  participants: ['host', 'guest'], guesserId: 'guest',
  durationSeconds: 60, deck: { deckId: 'deck', contentHash: hash, sponsorId: 'host' },
  cards: [{ answer: 'SECRET ANSWER', byline: 'SECRET BYLINE' }],
}, () => 'card-nonce');
const guestView = round.viewFor('guest', 0)!;
const session: SharePlaySnapshot = {
  revision: 1, status: 'joined', sessionId: 'session', localParticipantId: 'guest',
  participantIds: ['host', 'guest'], isHost: false, hostParticipantId: 'host',
  activity: { protocolVersion: 4, environment: 'test', nonce: 'nonce',
    deckId: 'deck', deckTitle: 'Deck', durationSeconds: 60, hostPublicKey: 'key' },
};

for (const phase of ['countdown', 'playing', 'feedback'] as const) {
  for (const guesser of [true, false]) {
    test(`backgrounding a guest ${guesser ? 'guesser pauses' : 'clue giver keeps'} ${phase}`, () => {
      const sent: string[] = [];
      const game = new LiveGame({ environment: 'test', uuid: () => 'background-intent',
        digest: async () => hash, send: async (body) => { sent.push(body); },
        cards: () => null, availableDeckIds: () => [], onDecks: () => undefined,
        onView: () => undefined, onError: () => undefined, onActive: () => undefined,
        onLobby: () => undefined });
      game.setSession(session);
      const snapshot = { ...guestView, phase, guesserId: guesser ? 'guest' : 'host',
        startsAt: 3000, deadline: 63000,
        canAnswer: phase === 'playing' && guesser,
        cardNonce: phase === 'playing' && guesser ? 'nonce' : null,
        card: phase === 'playing' && !guesser ? { answer: 'SECRET', byline: '' } : null,
        feedback: phase === 'feedback' ? 'correct' : null };
      game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true,
        body: JSON.stringify({ version: 3, kind: 'view', view: snapshot, hostTime: 0 }) });
      assert.equal(game.currentView?.phase, phase);
      sent.length = 0;
      game.setForeground(false);
      game.setForeground(false);
      const pauses = sent.map((body) => JSON.parse(body)).filter((wire) =>
        wire.kind === 'intent' && wire.intent.kind === 'pause');
      assert.equal(pauses.length, guesser ? 1 : 0);
      assert.equal(game.currentView, null);
      game.setForeground(true);
      assert.ok(sent.map((body) => JSON.parse(body)).some((wire) => wire.kind === 'snapshot-request'));
    });
  }
}

for (const hostGuesses of [false, true]) {
  test(`backgrounding a host ${hostGuesses ? 'guesser pauses' : 'clue giver keeps publishing'}`, async (context) => {
    let sequence = 0;
    const sent: string[] = [];
    const game = new LiveGame({ environment: 'test', uuid: () => `background-${++sequence}`,
      digest: async () => hash, send: async (body) => { sent.push(body); },
      cards: () => [{ answer: 'ANSWER', byline: '' }], availableDeckIds: () => ['deck'],
      onDecks: () => undefined, onView: () => undefined, onError: (message) => { throw new Error(message); },
      onActive: () => undefined, onLobby: () => undefined });
    game.setSession({ ...session, localParticipantId: 'host', isHost: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!hostGuesses) game.selectGuesser('guest');
    game.act('ready');
    const view = game.currentView!;
    game.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false,
      body: JSON.stringify({ version: 3, kind: 'intent', intent: {
        protocol: 1, sessionId: 'session', environment: 'test', roundId: view.roundId,
        intentId: 'guest-ready', revision: view.revision, kind: 'ready', contentHash: hash } }) });
    game.act('start');
    const deadline = game.currentView?.deadline;
    game.setForeground(false);
    assert.equal(game.currentView?.phase, hostGuesses ? 'paused' : 'countdown');
    if (!hostGuesses) {
      assert.equal(game.currentView?.deadline, deadline);
      sent.length = 0;
      const now = game.currentView!.startsAt! + 1;
      context.mock.method(performance, 'now', () => now);
      game.pulse();
      assert.ok(sent.map((body) => JSON.parse(body)).some((wire) => wire.kind === 'host-claim'));
      game.setForeground(true);
      assert.equal(game.currentView?.deadline, deadline);
      game.act('pause');
      assert.equal(game.currentView?.phase, 'paused');
    }
  });
}

test('wire decoder rejects extra fields, oversize packets and wrong versions', () => {
  const valid = JSON.stringify({ version: 3, kind: 'view', view: guestView, hostTime: 0 });
  assert.equal(parseGameWire(valid)?.kind, 'view');
  assert.equal(parseGameWire(JSON.stringify({ version: 1, kind: 'view', view: guestView, hostTime: 0 })), null);
  assert.equal(parseGameWire(JSON.stringify({ version: 3, kind: 'view', view: guestView, hostTime: 0, senderId: 'host' })), null);
  assert.equal(parseGameWire('x'.repeat(16_385)), null);
  const reaction = { version: 3, kind: 'reaction', roundId: 'round', reactionId: 'reaction-1',
    emoji: 3, set: 'results' };
  assert.equal(parseGameWire(JSON.stringify(reaction))?.kind, 'reaction');
  for (const invalid of [{ ...reaction, emoji: 4 }, { ...reaction, emoji: '😂' },
    { ...reaction, set: 'feedback' }, { ...reaction, senderId: 'guest' },
    { ...reaction, roundId: '' }])
    assert.equal(parseGameWire(JSON.stringify(invalid)), null);
});

test('only the current host and authority generation can end the shared game', () => {
  let ended = 0;
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined, onSessionEnd: () => { ended++; } });
  game.setSession({ ...session, participantIds: ['host', 'guest', 'other'], hostTerm: 2, electedHost: true });
  const message = (senderId: string, term: number) => ({ sessionId: 'session', senderId,
    senderIsHost: false, body: JSON.stringify({ version: 3, kind: 'session-end', term }) });
  game.receive(message('other', 2));
  game.receive(message('host', 1));
  game.receive({ ...message('host', 2), sessionId: 'old-session' });
  assert.equal(ended, 0);
  game.receive(message('host', 2));
  assert.equal(ended, 1);
  assert.equal(parseGameWire(JSON.stringify({ version: 3, kind: 'session-end', term: -1 })), null);
});

test('a lobby host can hand off before suspension and an elected host can broadcast End Game', async () => {
  const sent: string[] = [];
  const transfers: string[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async (body) => { sent.push(body); }, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined, onHostTransfer: (id) => transfers.push(id) });
  game.setSession({ ...session, localParticipantId: 'host', isHost: true, electedHost: true, hostTerm: 2 });
  sent.length = 0;
  game.setForeground(false);
  assert.equal(await game.transferHost('guest', true), true);
  assert.deepEqual(transfers, ['guest']);
  assert.deepEqual(JSON.parse(sent[0]), { version: 3, kind: 'host-transfer', targetId: 'guest', term: 3 });
  await game.endSession();
  assert.deepEqual(JSON.parse(sent.at(-1)!), { version: 3, kind: 'session-end', term: 2 });
  game.setSession(session);
  await assert.rejects(game.endSession(), /notHost/);
});

for (const { anotherOwnerRemains, active } of [
  { anotherOwnerRemains: false, active: false },
  { anotherOwnerRemains: false, active: true },
  { anotherOwnerRemains: true, active: false },
]) {
  test(`departing deck owner ${anotherOwnerRemains ? 'keeps selection when another owner remains' :
    active ? 'clears selection while allowing the prepared round to finish' : 'clears selection on both phones'}`, async () => {
    let sequence = 0;
    const roster = { ...session, participantIds: ['host', 'guest', 'owner'] };
    let hostSelection: string | null = null;
    let guestSelection: string | null = null;
    let available: string[] = [];
    const sent: string[] = [];
    let guest!: LiveGame;
    const common = { environment: 'test', uuid: () => `departure-${++sequence}`,
      digest: async () => hash, onView: () => undefined, onLobby: () => undefined,
      onActive: () => undefined, onError: (message: string) => { throw new Error(message); } };
    const host = new LiveGame({ ...common,
      availableDeckIds: () => anotherOwnerRemains ? ['deck', 'other'] : ['other'],
      cards: () => [{ answer: 'ANSWER', byline: '' }],
      onDecks: (selected, ids) => { hostSelection = selected; available = ids; },
      send: async (body, ids) => {
        sent.push(body);
        if (ids.includes('guest')) await Promise.resolve().then(() =>
          guest.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body }));
      },
    });
    guest = new LiveGame({ ...common, availableDeckIds: () => [], cards: () => null,
      onDecks: (selected) => { guestSelection = selected; },
      send: async (body) => { await Promise.resolve().then(() =>
        host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body })); },
    });
    host.setSession({ ...roster, localParticipantId: 'host', isHost: true });
    guest.setSession(roster);
    host.receive({ sessionId: 'session', senderId: 'owner', senderIsHost: false,
      body: JSON.stringify({ version: 3, kind: 'inventory', generation: 'owner-inventory',
        index: 0, total: 1, deckIds: ['deck'] }) });
    if (!anotherOwnerRemains) {
      const request = sent.map((body) => JSON.parse(body)).find((wire) => wire.kind === 'deck-request');
      assert.ok(request);
      host.receive({ sessionId: 'session', senderId: 'owner', senderIsHost: false,
        body: JSON.stringify({ version: 3, kind: 'deck-cards', requestId: request.requestId,
          deckId: 'deck', contentHash: hash, cards: [{ answer: 'ANSWER', byline: '' }] }) });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(host.currentView?.phase, 'lobby');
    assert.equal(guest.currentView?.phase, 'lobby');
    if (active) {
      host.act('ready'); guest.act('ready');
      const view = host.currentView!;
      host.receive({ sessionId: 'session', senderId: 'owner', senderIsHost: false,
        body: JSON.stringify({ version: 3, kind: 'intent', intent: {
          protocol: 1, sessionId: 'session', environment: 'test', roundId: view.roundId,
          intentId: 'owner-ready', revision: view.revision, kind: 'ready', contentHash: hash,
        } }) });
      await new Promise((resolve) => setTimeout(resolve, 0));
      host.act('start');
      await new Promise((resolve) => setTimeout(resolve, 0));
      assert.equal(host.currentView?.phase, 'countdown');
    } else {
      host.act('ready'); guest.act('ready');
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const remaining = { ...roster, participantIds: ['host', 'guest'] };
    guest.setSession(remaining);
    host.setSession({ ...remaining, localParticipantId: 'host', isHost: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(hostSelection, anotherOwnerRemains ? 'deck' : null);
    assert.equal(guestSelection, anotherOwnerRemains ? 'deck' : null);
    assert.equal(available.includes('deck'), anotherOwnerRemains);
    if (!anotherOwnerRemains) {
      if (active) {
        assert.equal(host.currentView?.phase, 'countdown');
        assert.equal(guest.currentView?.phase, 'countdown');
        host.act('end'); host.returnToLobby();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assert.equal(host.currentView?.phase, 'lobby');
      assert.equal(guest.currentView?.phase, 'lobby');
      if (!active) assert.deepEqual(new Set(host.currentView?.ready), new Set(['host', 'guest']));
      host.act('ready');
      assert.equal(host.currentView?.phase, 'lobby');
      host.selectDeck('other');
      await new Promise((resolve) => setTimeout(resolve, 0));
      const nextHostView = host.currentView as RemoteView | null;
      const nextGuestView = guest.currentView as RemoteView | null;
      assert.equal(nextHostView?.deck.deckId, 'other');
      assert.equal(nextGuestView?.deck.deckId, 'other');
      assert.deepEqual(new Set(nextHostView?.ready), new Set(active ? ['host'] : ['host', 'guest']));
    }
  });
}

test('client projection decoder refuses secret answer on guesser phone and controls on clue phones', () => {
  assert.ok(parseRemoteView(guestView, 'session', 'guest'));
  assert.equal(parseRemoteView({ ...guestView, card: { answer: 'LEAK', byline: '' } }, 'session', 'guest'), null);
  const base = { protocol: 1, sessionId: 'session', environment: 'test', roundId: 'round' };
  assert.equal(round.receive('host', JSON.stringify({ ...base, intentId: 'ready-host', revision: 0, kind: 'ready', contentHash: hash }), 0), 'accepted');
  assert.equal(round.receive('guest', JSON.stringify({ ...base, intentId: 'ready-guest', revision: 1, kind: 'ready', contentHash: hash }), 0), 'accepted');
  assert.equal(round.receive('host', JSON.stringify({ ...base, intentId: 'start', revision: 2, kind: 'start' }), 0), 'accepted');
  const playing = round.viewFor('guest', 3000)!;
  assert.ok(parseRemoteView(playing, 'session', 'guest'));
  assert.equal(parseRemoteView({ ...playing, card: { answer: 'LEAK', byline: '' } }, 'session', 'guest'), null);
  assert.equal(parseRemoteView({ ...playing, cardNonce: null }, 'session', 'guest'), null);
  assert.equal(parseRemoteView({ ...playing, canAnswer: false }, 'session', 'guest'), null);
  const clue = round.viewFor('host', 3000)!;
  assert.equal(parseRemoteView({ ...clue, cardNonce: 'nonce' }, 'session', 'host'), null);
  assert.equal(parseRemoteView({ ...guestView, unknown: 'LEAK' }, 'session', 'guest'), null);
  assert.equal(parseRemoteView(guestView, 'older-session', 'guest'), null);
});

test('live guest accepts only native-authenticated host views', () => {
  const views: string[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined,
    cards: () => null, availableDeckIds: () => [], onDecks: () => undefined,
    onView: (view) => { if (view) views.push(view.roundId); },
    onError: () => undefined, onActive: () => undefined, onLobby: () => undefined });
  game.setSession(session);
  const body = JSON.stringify({ version: 3, kind: 'view', view: guestView, hostTime: 0 });
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: false, body });
  game.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: true, body });
  assert.deepEqual(views, []);
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body });
  assert.deepEqual(views, ['round']);
  assert.equal(game.currentView?.card, null);
});

test('a newer deck-selection packet cannot hide its preceding lobby view', () => {
  const views: RemoteView[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: (view) => { if (view) views.push(view); }, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined });
  game.setSession(session);
  const deliver = (wire: object) => game.receive({ sessionId: 'session', senderId: 'host',
    senderIsHost: true, body: JSON.stringify(wire) });
  // The host sends these in this order, but the transport can deliver them in reverse.
  deliver({ version: 3, kind: 'deck-selection', deckId: 'deck', durationSeconds: 60,
    hostTime: 101, inLobby: true, mode: 'classic' });
  deliver({ version: 3, kind: 'view', view: guestView, hostTime: 100 });
  assert.equal(game.currentView?.phase, 'lobby');
  assert.equal(game.currentView?.deck.deckId, 'deck');
  deliver({ version: 3, kind: 'deck-selection', deckId: 'other', durationSeconds: 60,
    hostTime: 201, inLobby: true, mode: 'classic' });
  deliver({ version: 3, kind: 'view', view: guestView, hostTime: 200 });
  assert.equal(views.length, 1);
});

test('a guesser records the unanswered card from results exactly once', () => {
  const seen: string[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined,
    onCardSeen: (card) => seen.push(card.answer),
    onError: () => undefined, onActive: () => undefined, onLobby: () => undefined });
  game.setSession(session);
  const resultView: RemoteView = { ...guestView, revision: 1, phase: 'results',
    resultReason: 'time', startsAt: 3000, deadline: 63000, remainingMs: 0,
    results: [{ answer: 'SECRET ANSWER', byline: 'SECRET BYLINE', outcome: 'neutral' }] };
  const message = { sessionId: 'session', senderId: 'host', senderIsHost: true,
    body: JSON.stringify({ version: 3, kind: 'view', view: resultView, hostTime: 63000 }) };
  game.receive(message);
  game.receive(message);
  assert.deepEqual(seen, ['SECRET ANSWER']);
});

test('remaining players elect a host and return to a playable lobby when the inviter leaves', async () => {
  let sequence = 0;
  const sent: Promise<void>[] = [];
  const lobbyEvents: string[] = [];
  let alice!: LiveGame;
  let bob!: LiveGame;
  const base = { ...session, participantIds: ['alice', 'bob', 'inviter'], hostParticipantId: 'inviter' };
  const options = { environment: 'test', uuid: () => `id-${++sequence}`,
    digest: async () => hash, onDecks: () => undefined, onView: () => undefined,
    onError: (message: string) => { throw new Error(message); },
    onActive: () => undefined };
  alice = new LiveGame({ ...options, cards: () => [{ answer: 'ANSWER', byline: '' }],
    availableDeckIds: () => ['deck'], onLobby: () => lobbyEvents.push('alice'),
    send: async (body, ids) => { if (ids.includes('bob')) sent.push(Promise.resolve().then(() =>
      bob.receive({ sessionId: 'session', senderId: 'alice', senderIsHost: false, body }))); },
  });
  bob = new LiveGame({ ...options, cards: () => null, availableDeckIds: () => [],
    onLobby: () => lobbyEvents.push('bob'),
    send: async (body, ids) => { if (ids.includes('alice')) sent.push(Promise.resolve().then(() =>
      alice.receive({ sessionId: 'session', senderId: 'bob', senderIsHost: false, body }))); },
  });
  alice.setSession({ ...base, localParticipantId: 'alice' });
  bob.setSession({ ...base, localParticipantId: 'bob' });
  const remaining = { ...base, participantIds: ['alice', 'bob'] };
  alice.setSession(resolveSharePlayHost({ ...remaining, localParticipantId: 'alice' }));
  bob.setSession(resolveSharePlayHost({ ...remaining, localParticipantId: 'bob' }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(sent);
  assert.equal(alice.currentView?.phase, 'lobby');
  assert.equal(bob.currentView?.phase, 'lobby');
  assert.equal(bob.currentView?.hostId, 'alice');
  assert.deepEqual(new Set(lobbyEvents), new Set(['alice', 'bob']));
});

test('only the current host can transfer control to an active participant', () => {
  const transfers: string[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined,
    onHostTransfer: (id) => transfers.push(id) });
  game.setSession(session);
  const body = JSON.stringify({ version: 3, kind: 'host-transfer', targetId: 'guest' });
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: false, body });
  game.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body });
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true,
    body: JSON.stringify({ version: 3, kind: 'host-transfer', targetId: 'absent' }) });
  assert.deepEqual(transfers, []);
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body });
  assert.deepEqual(transfers, ['guest']);
});

test('a restarted host generation resets the guest clock and accepts the recovered unsigned host', () => {
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined });
  game.setSession({ ...session, hostTerm: 0 });
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true,
    body: JSON.stringify({ version: 3, kind: 'view', view: guestView, hostTime: 10000 }) });
  assert.equal(game.currentView?.roundId, 'round');
  game.setSession({ ...session, hostTerm: 1, electedHost: true });
  assert.equal(game.currentView, null);
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: false,
    body: JSON.stringify({ version: 3, kind: 'view', view: { ...guestView, roundId: 'recovered-round' }, hostTime: 1 }) });
  assert.equal((game.currentView as RemoteView | null)?.roundId, 'recovered-round');
});

test('a former host receives successor announcements so it can yield automatically', () => {
  const claims: [string, boolean, number][] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined,
    onHostClaim: (id, signed, term) => claims.push([id, signed, term]) });
  game.setSession({ ...session, localParticipantId: 'host', isHost: true, hostTerm: 0 });
  game.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false,
    body: JSON.stringify({ version: 3, kind: 'host-claim', term: 1 }) });
  assert.deepEqual(claims, [['guest', false, 1]]);
  assert.equal(parseGameWire(JSON.stringify({ version: 3, kind: 'host-claim', term: -1 })), null);
});

test('a restarted host generation resets the guest clock and accepts the recovered unsigned host', () => {
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined });
  game.setSession({ ...session, hostTerm: 0 });
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true,
    body: JSON.stringify({ version: 3, kind: 'view', view: guestView, hostTime: 10000 }) });
  assert.equal(game.currentView?.roundId, 'round');
  game.setSession({ ...session, hostTerm: 1, electedHost: true });
  assert.equal(game.currentView, null);
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: false,
    body: JSON.stringify({ version: 3, kind: 'view', view: { ...guestView, roundId: 'recovered-round' }, hostTime: 1 }) });
  assert.equal((game.currentView as RemoteView | null)?.roundId, 'recovered-round');
});

test('a former host receives successor announcements so it can yield automatically', () => {
  const claims: [string, boolean, number][] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'id', digest: async () => hash,
    send: async () => undefined, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined,
    onHostClaim: (id, signed, term) => claims.push([id, signed, term]) });
  game.setSession({ ...session, localParticipantId: 'host', isHost: true, hostTerm: 0 });
  game.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false,
    body: JSON.stringify({ version: 3, kind: 'host-claim', term: 1 }) });
  assert.deepEqual(claims, [['guest', false, 1]]);
  assert.equal(parseGameWire(JSON.stringify({ version: 3, kind: 'host-claim', term: -1 })), null);
});

test('guesser can submit an answer while clock calibration is temporarily unavailable', () => {
  const activeRound = new RemoteRound({
    sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'active',
    participants: ['host', 'guest'], guesserId: 'guest', durationSeconds: 60,
    deck: { deckId: 'deck', contentHash: hash, sponsorId: 'host' },
    cards: [{ answer: 'SECRET ANSWER', byline: '' }],
  }, () => 'card-nonce');
  const base = { protocol: 1, sessionId: 'session', environment: 'test', roundId: 'active' };
  assert.equal(activeRound.receive('host', JSON.stringify({ ...base, intentId: 'ready-host', revision: 0,
    kind: 'ready', contentHash: hash }), 0), 'accepted');
  assert.equal(activeRound.receive('guest', JSON.stringify({ ...base, intentId: 'ready-guest', revision: 1,
    kind: 'ready', contentHash: hash }), 0), 'accepted');
  assert.equal(activeRound.receive('host', JSON.stringify({ ...base, intentId: 'start', revision: 2,
    kind: 'start' }), 0), 'accepted');
  const sent: string[] = [];
  const game = new LiveGame({ environment: 'test', uuid: () => 'answer-id', digest: async () => hash,
    send: async (body) => { sent.push(body); }, cards: () => null, availableDeckIds: () => [],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined });
  game.setSession(session);
  game.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true,
    body: JSON.stringify({ version: 3, kind: 'view', view: activeRound.viewFor('guest', 3000), hostTime: 3000 }) });
  assert.equal(game.synchronized, false);
  game.act('answer', 'correct');
  assert.equal(sent.some((body) => parseGameWire(body)?.kind === 'intent'), true);
});

test('host ends a two-player round on departure and prepares a new lobby when someone rejoins', async () => {
  let sequence = 0;
  const shared = { ...session, localParticipantId: 'host', isHost: true };
  const host = new LiveGame({ environment: 'test', uuid: () => `id-${++sequence}`, digest: async () => hash,
    send: async () => undefined, cards: () => [{ answer: 'ANSWER', byline: '' }],
    availableDeckIds: () => ['deck'], onDecks: () => undefined, onView: () => undefined,
    onError: (message) => { throw new Error(message); }, onActive: () => undefined, onLobby: () => undefined });
  host.setSession(shared);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.currentView?.phase, 'lobby');
  host.act('ready');
  const current = host.currentView!;
  host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false,
    body: JSON.stringify({ version: 3, kind: 'intent', intent: { protocol: 1,
      sessionId: 'session', environment: 'test', roundId: current.roundId,
      intentId: 'guest-ready', revision: current.revision, kind: 'ready', contentHash: hash } }) });
  host.act('start');
  assert.equal(host.currentView?.phase, 'countdown');
  host.setSession({ ...shared, participantIds: ['host'] });
  assert.equal(host.currentView?.phase, 'results');
  host.setSession({ ...shared, participantIds: ['host', 'returning'] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.currentView?.phase, 'lobby');
  assert.deepEqual(host.currentView?.participants, ['host', 'returning']);
  assert.deepEqual(host.currentView?.ready, []);
});

test('rejoining players retain a controller and recover when deck cards load after the roster', async (context) => {
  let now = 1000;
  context.mock.method(performance, 'now', () => now);
  let cardsLoaded = false;
  let sequence = 0;
  const clients = new Map<string, LiveGame>();
  const deliveries: Promise<void>[] = [];
  const controllers: Record<string, string | null> = { host: null, guest: null };
  const flush = async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      await Promise.all(deliveries.splice(0));
      await Promise.resolve();
    }
  };
  for (const id of ['host', 'guest']) clients.set(id, new LiveGame({ environment: 'test',
    uuid: () => `rejoin-${++sequence}`, digest: async () => hash,
    cards: () => cardsLoaded ? [{ answer: 'ANSWER', byline: '' }] : [],
    availableDeckIds: () => ['deck'], onView: () => undefined,
    onDecks: (_deck, _available, _duration, _mode, controllerId) => { controllers[id] = controllerId; },
    onError: (message) => { throw new Error(message); },
    onActive: () => undefined, onLobby: () => undefined,
    send: async (body, recipients) => { for (const recipient of recipients)
      deliveries.push(Promise.resolve().then(() => clients.get(recipient)!.receive({
        sessionId: 'session', senderId: id, senderIsHost: id === 'host', body }))); },
  }));
  const host = clients.get('host')!;
  const guest = clients.get('guest')!;
  const rejoinSession = { ...session, activity: { ...session.activity!, deckId: 'missing' } };
  host.setSession({ ...rejoinSession, localParticipantId: 'host', isHost: true });
  guest.setSession(rejoinSession);
  await flush();
  assert.equal(host.currentView?.phase ?? null, null);
  assert.equal(guest.currentView?.phase ?? null, null);
  assert.deepEqual(controllers, { host: 'host', guest: 'host' });
  guest.selectGuesser('guest'); await flush();
  assert.deepEqual(controllers, { host: 'host', guest: 'host' });
  host.selectGuesser('guest'); await flush();
  assert.deepEqual(controllers, { host: 'guest', guest: 'guest' });
  guest.selectMode('pass-n-play'); await flush();
  guest.selectDuration(45); await flush();
  guest.selectDeck('deck'); await flush();
  assert.equal(host.currentView?.phase ?? null, null);
  cardsLoaded = true;
  host.refreshAvailableDecks(); await flush();
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(guest.currentView?.phase, 'lobby');
  assert.equal(host.currentView?.guesserId, 'guest');
  assert.equal(guest.currentView?.mode, 'pass-n-play');
  assert.equal(guest.currentView?.durationSeconds, 45);
  now = 4000;
  guest.act('ready'); host.act('ready'); await flush();
  assert.deepEqual(new Set(host.currentView?.ready), new Set(['guest', 'host']));
});

test('the inviter’s game mode choice carries into the first shared lobby', async () => {
  const host = new LiveGame({ environment: 'test', uuid: () => 'first-round', digest: async () => hash,
    send: async () => undefined, cards: () => [{ answer: 'ANSWER', byline: '' }],
    initialMode: () => 'pass-n-play', availableDeckIds: () => ['deck'],
    onDecks: () => undefined, onView: () => undefined, onError: () => undefined,
    onActive: () => undefined, onLobby: () => undefined });
  host.setSession({ ...session, localParticipantId: 'host', isHost: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(host.currentView?.mode, 'pass-n-play');
});

test('all players see the matching reaction set during play and results', async (context) => {
  let now = 1000;
  context.mock.method(performance, 'now', () => now);
  let sequence = 0;
  let host!: LiveGame;
  let guest!: LiveGame;
  const deliveries: Promise<void>[] = [];
  const hostReactions: string[] = [];
  const guestReactions: string[] = [];
  const common = { environment: 'test', uuid: () => `reaction-${++sequence}`,
    digest: async () => hash, onView: () => undefined, onDecks: () => undefined,
    onError: (message: string) => { throw new Error(message); },
    onActive: () => undefined, onLobby: () => undefined };
  const flush = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await Promise.all(deliveries.splice(0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  host = new LiveGame({ ...common, cards: () => [{ answer: 'ANSWER', byline: '' }],
    availableDeckIds: () => ['deck'], onReaction: (reaction) => hostReactions.push(`${reaction.set}:${reaction.emoji}`),
    send: async (body, ids) => { if (ids.includes('guest')) deliveries.push(Promise.resolve().then(() =>
      guest.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body }))); },
  });
  guest = new LiveGame({ ...common, cards: () => null, availableDeckIds: () => [],
    onReaction: (reaction) => guestReactions.push(`${reaction.set}:${reaction.emoji}`),
    send: async (body, ids) => { if (ids.includes('host')) deliveries.push(Promise.resolve().then(() =>
      host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body }))); },
  });
  host.setSession({ ...session, localParticipantId: 'host', isHost: true });
  guest.setSession(session);
  await flush();
  assert.equal(guest.currentView?.phase, 'lobby');
  host.act('ready'); guest.act('ready');
  await flush();
  host.act('start');
  await flush();
  assert.equal(guest.currentView?.phase, 'countdown');

  host.react(0);
  await flush();
  assert.deepEqual(hostReactions, ['round:0']);
  assert.deepEqual(guestReactions, ['round:0']);
  host.react(1); // Same player cannot spam another reaction immediately.
  await flush();
  assert.deepEqual(guestReactions, ['round:0']);
  guest.react(3);
  await flush();
  assert.deepEqual(hostReactions, ['round:0', 'round:3']);
  assert.deepEqual(guestReactions, ['round:0', 'round:3']);
  now = 65_000;
  host.pulse();
  await flush();
  assert.equal(host.currentView?.phase, 'results');
  assert.equal(guest.currentView?.phase, 'results');
  host.react(0);
  await flush();
  assert.deepEqual(hostReactions, ['round:0', 'round:3', 'results:0']);
  assert.deepEqual(guestReactions, ['round:0', 'round:3', 'results:0']);
});

test('host and a guest without deck ownership reach the same countdown', async () => {
  let sequence = 0;
  const deliveries: Promise<void>[] = [];
  let host!: LiveGame;
  let guest!: LiveGame;
  const shared = { ...session, localParticipantId: 'host', isHost: true };
  const options = { environment: 'test', uuid: () => `id-${++sequence}`,
    digest: async () => hash, onView: () => undefined,
    availableDeckIds: () => ['deck', 'other'], onDecks: () => undefined,
    onError: (message: string) => { throw new Error(message); },
    onActive: () => undefined, onLobby: () => undefined };
  host = new LiveGame({ ...options,
    cards: () => [{ answer: 'SECRET ANSWER', byline: 'SECRET BYLINE' }],
    send: async (body, ids) => { if (ids.includes('guest')) {
      deliveries.push(Promise.resolve().then(() => guest.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body })));
    } },
  });
  guest = new LiveGame({ ...options, cards: () => null, availableDeckIds: () => [],
    send: async (body, ids) => { if (ids.includes('host')) {
      deliveries.push(Promise.resolve().then(() => host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body })));
    } },
  });
  host.setSession(shared);
  guest.setSession(session);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(deliveries);
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(guest.currentView?.phase, 'lobby');
  host.selectDuration(90);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(deliveries.splice(0));
  assert.equal(host.currentView?.durationSeconds, 90);
  assert.equal(guest.currentView?.durationSeconds, 90);
  guest.act('ready'); host.act('ready');
  await Promise.all(deliveries);
  assert.deepEqual(new Set(host.currentView?.ready), new Set(['host', 'guest']));
  host.act('start');
  await Promise.all(deliveries);
  assert.equal(host.currentView?.phase, 'countdown');
  assert.equal(guest.currentView?.phase, 'countdown');
  assert.doesNotMatch(JSON.stringify(guest.currentView), /SECRET ANSWER|SECRET BYLINE/);
  host.act('pause');
  host.returnToLobby();
  await Promise.all(deliveries.splice(0));
  host.selectDeck('other');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(deliveries.splice(0));
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(host.currentView?.deck.deckId, 'other');
  assert.equal(guest.currentView?.deck.deckId, 'other');
});

test('a guest-owned deck can sponsor a round when the inviter has no cards', async () => {
  let sequence = 0;
  let host!: LiveGame;
  let owner!: LiveGame;
  const deliveries: Promise<void>[] = [];
  const shared = { ...session, localParticipantId: 'host', isHost: true };
  const common = { environment: 'test', uuid: () => `guest-owned-${++sequence}`,
    digest: async () => hash, onView: () => undefined, onDecks: () => undefined,
    onError: (message: string) => { throw new Error(message); },
    onActive: () => undefined, onLobby: () => undefined };
  host = new LiveGame({ ...common, availableDeckIds: () => [], cards: () => null,
    send: async (body, ids) => { if (ids.includes('guest')) deliveries.push(Promise.resolve().then(() =>
      owner.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body }))); },
  });
  owner = new LiveGame({ ...common, availableDeckIds: () => ['deck'],
    cards: () => [{ answer: 'PAID ANSWER', byline: 'PAID BYLINE' }],
    send: async (body, ids) => { if (ids.includes('host')) deliveries.push(Promise.resolve().then(() =>
      host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body }))); },
  });
  host.setSession(shared);
  owner.setSession(session);
  for (let i = 0; i < 8; i++) {
    await Promise.all(deliveries.splice(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(host.currentView?.deck.sponsorId, 'guest');
  assert.equal(owner.currentView?.phase, 'lobby');
  owner.act('ready'); host.act('ready');
  for (let i = 0; i < 3; i++) await Promise.all(deliveries.splice(0));
  host.act('start');
  await Promise.all(deliveries.splice(0));
  assert.equal(owner.currentView?.phase, 'countdown');
  assert.equal(owner.currentView?.guesserId, 'host');
  assert.doesNotMatch(JSON.stringify(host.currentView), /PAID ANSWER|PAID BYLINE/);
});

test('host retries a lost deck inventory request after both phones join', async () => {
  let sequence = 0;
  let host!: LiveGame;
  let owner!: LiveGame;
  let requests = 0;
  const deliveries: Promise<void>[] = [];
  const shared = { ...session, localParticipantId: 'host', isHost: true };
  const common = { environment: 'test', uuid: () => `retry-${++sequence}`,
    digest: async () => hash, onView: () => undefined, onDecks: () => undefined,
    onError: (message: string) => { throw new Error(message); },
    onActive: () => undefined, onLobby: () => undefined };
  host = new LiveGame({ ...common, availableDeckIds: () => [], cards: () => null,
    send: async (body, ids) => {
      if (!ids.includes('guest')) return;
      if (JSON.parse(body).kind === 'host-claim') return;
      if (JSON.parse(body).kind === 'inventory-request' && ++requests === 1) return;
      deliveries.push(Promise.resolve().then(() => {
        owner.setSession(session);
        owner.receive({ sessionId: 'session', senderId: 'host', senderIsHost: true, body });
      }));
    },
  });
  owner = new LiveGame({ ...common, availableDeckIds: () => ['deck'],
    cards: () => [{ answer: 'GUEST ANSWER', byline: '' }],
    send: async (body, ids) => { if (ids.includes('host')) deliveries.push(Promise.resolve().then(() =>
      host.receive({ sessionId: 'session', senderId: 'guest', senderIsHost: false, body }))); },
  });
  host.setSession(shared);
  owner.setSession({ ...session, hostParticipantId: null });
  assert.equal(Boolean(host.currentView), false);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  host.pulse();
  for (let i = 0; i < 6; i++) {
    await Promise.all(deliveries.splice(0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(requests >= 2);
  assert.equal(host.currentView?.phase, 'lobby');
  assert.equal(host.currentView?.deck.sponsorId, 'guest');
});
