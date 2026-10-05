import assert from 'node:assert/strict';
import test from 'node:test';
import type { SharePlaySnapshot } from '../../modules/whatz-it-shareplay/src/WhatzItSharePlay.types';
import { parseRemoteView } from './game-wire';
import { LiveGame } from './live-game';
import { RemoteRound, type RemoteIntent } from './remote-round';

const contentHash = 'a'.repeat(64);
const members = ['host', 'alice', 'bob'];
let intentId = 0;
function create(participants = members) {
  let nonce = 0;
  return new RemoteRound({ sessionId: 'session', environment: 'test', roundId: 'round',
    hostId: 'host', guesserId: 'alice', mode: 'pass-n-play', participants,
    durationSeconds: 30, deck: { deckId: 'deck', contentHash, sponsorId: 'host' },
    cards: Array.from({ length: Math.max(10, participants.length + 1) }, (_, index) => ({ answer: `SECRET-${index}`, byline: '' })),
  }, () => `nonce-${++nonce}`);
}
function act(round: RemoteRound, sender: string, now: number,
  payload: { kind: RemoteIntent['kind']; cardNonce?: string | null; outcome?: string; contentHash?: string }) {
  return round.receive(sender, JSON.stringify({ protocol: 1, sessionId: 'session', environment: 'test',
    roundId: 'round', revision: round.viewFor(sender, now)?.revision ?? 0,
    intentId: `intent-${++intentId}`, ...payload }), now);
}
function start(round: RemoteRound, participants = members) {
  for (const id of participants) assert.equal(act(round, id, 0, { kind: 'ready', contentHash }), 'accepted');
  assert.equal(act(round, 'host', 0, { kind: 'start' }), 'accepted');
  round.tick(3000);
}
function correct(round: RemoteRound, now: number) {
  const view = round.viewFor('host', now)!;
  const guesser = round.viewFor(view.guesserId, now)!;
  assert.equal(act(round, view.guesserId, now, { kind: 'answer', outcome: 'correct',
    cardNonce: guesser.cardNonce }), 'accepted');
}

test('pass keeps the clue giver; correct cycles through every player with a running-clock handoff', () => {
  const round = create(); start(round);
  const deadline = round.viewFor('alice', 3000)!.deadline;
  assert.equal(act(round, 'alice', 3000, { kind: 'answer', outcome: 'pass',
    cardNonce: round.viewFor('alice', 3000)!.cardNonce }), 'accepted');
  assert.equal(round.viewFor('alice', 3600)!.guesserId, 'alice');
  assert.equal(round.viewFor('alice', 3600)!.phase, 'playing');
  let now = 3700;
  for (const next of ['bob', 'host', 'alice']) {
    correct(round, now);
    now += 600;
    const handoff = round.viewFor(next, now)!;
    assert.equal(handoff.phase, 'handoff');
    assert.equal(handoff.guesserId, next);
    assert.equal(handoff.deadline, deadline);
    for (const id of members) {
      const view = round.viewFor(id, now)!;
      assert.equal(view.card, null);
      assert.ok(parseRemoteView(view, 'session', id));
    }
    assert.equal(act(round, next, now, { kind: 'reveal', cardNonce: handoff.cardNonce }), 'accepted');
    assert.ok(round.viewFor(next, now)!.card);
    assert.equal(round.viewFor(next, now)!.canAnswer, true);
    assert.equal(round.viewFor(next === 'host' ? 'alice' : 'host', now)!.card, null);
    now += 100;
  }
  assert.equal(round.viewFor('host', now)!.score, 3);
});

test('only the next clue giver can reveal; previous scoring and handoff tokens cannot score a new card', () => {
  const round = create(); start(round);
  const oldNonce = round.viewFor('alice', 3000)!.cardNonce;
  correct(round, 3000);
  const handoff = round.viewFor('bob', 3600)!;
  assert.equal(act(round, 'host', 3600, { kind: 'reveal', cardNonce: handoff.cardNonce }), 'rejected');
  assert.equal(act(round, 'bob', 3600, { kind: 'answer', outcome: 'correct', cardNonce: handoff.cardNonce }), 'rejected');
  assert.equal(parseRemoteView({ ...handoff, card: { answer: 'LEAK', byline: '' } }, 'session', 'bob'), null);
  assert.equal(act(round, 'bob', 3600, { kind: 'reveal', cardNonce: handoff.cardNonce }), 'accepted');
  assert.equal(act(round, 'bob', 3600, { kind: 'answer', outcome: 'correct', cardNonce: handoff.cardNonce }), 'rejected');
  assert.equal(act(round, 'alice', 3600, { kind: 'answer', outcome: 'correct', cardNonce: oldNonce }), 'rejected');
});

for (const count of [8, 32]) test(`${count} players each give clues and the rest of the group never receives the answer`, () => {
  const players = ['host', 'alice', 'bob', ...Array.from({ length: count - 3 }, (_, i) => `p${i + 3}`)];
  const round = create(players); start(round, players);
  let now = 3000;
  for (const next of [...players.slice(2), 'host', 'alice']) {
    correct(round, now); now += 600;
    const handoff = round.viewFor(next, now)!;
    assert.equal(handoff.guesserId, next);
    assert.equal(handoff.card, null);
    assert.equal(act(round, next, now, { kind: 'reveal', cardNonce: handoff.cardNonce }), 'accepted');
    for (const id of players) {
      const view = round.viewFor(id, now)!;
      assert.ok(parseRemoteView(view, 'session', id));
      assert.equal(view.canAnswer, id === next);
      if (id === next) assert.ok(view.card);
      else {
        assert.equal(view.card, null);
        assert.doesNotMatch(JSON.stringify(view), /SECRET/);
        assert.equal(parseRemoteView({ ...view, card: { answer: 'LEAK', byline: '' } }, 'session', id), null);
      }
    }
    now += 100;
  }
});

test('a ninth player can join an existing round', () => {
  const players = ['host', 'alice', 'bob', 'p3', 'p4', 'p5', 'p6', 'p7'];
  const round = create(players);
  round.addParticipant('p8', 0);
  const view = round.viewFor('p8', 0)!;
  assert.equal(view.participants.length, 9);
  assert.ok(parseRemoteView(view, 'session', 'p8'));
});

test('handoff time counts toward the deadline and cannot reveal after time expires', () => {
  const round = create(); start(round); correct(round, 3000);
  const handoff = round.viewFor('bob', 3600)!;
  assert.equal(round.viewFor('host', 10000)!.remainingMs, 23000);
  assert.equal(act(round, 'bob', 33000, { kind: 'reveal', cardNonce: handoff.cardNonce }), 'rejected');
  assert.equal(round.viewFor('host', 33000)!.resultReason, 'time');
});

for (const pauseDuringFeedback of [false, true]) {
  test(`pause during ${pauseDuringFeedback ? 'correct feedback' : 'handoff'} resumes the same next clue giver after readiness`, () => {
    const round = create(); start(round); correct(round, 3000);
    const pausedAt = pauseDuringFeedback ? 3100 : 3700;
    assert.equal(act(round, 'host', pausedAt, { kind: 'pause' }), 'accepted');
    assert.equal(round.viewFor('host', pausedAt)!.guesserId, 'bob');
    for (const id of members) assert.equal(act(round, id, 5000, { kind: 'ready', contentHash }), 'accepted');
    assert.equal(act(round, 'host', 5000, { kind: 'resume' }), 'accepted');
    const resumed = round.viewFor('bob', 8000)!;
    assert.equal(resumed.phase, 'handoff');
    assert.equal(resumed.guesserId, 'bob');
    assert.equal(resumed.remainingMs, 33000 - pausedAt);
    assert.equal(act(round, 'bob', 8000, { kind: 'reveal', cardNonce: resumed.cardNonce }), 'accepted');
  });
}

test('a departing next clue giver is replaced without revealing a card or pausing the timer', () => {
  const round = create(); start(round); correct(round, 3000);
  const before = round.viewFor('bob', 3600)!;
  round.removeParticipant('bob', 3700);
  const after = round.viewFor('host', 3700)!;
  assert.equal(after.phase, 'handoff');
  assert.equal(after.guesserId, 'host');
  assert.equal(after.deadline, before.deadline);
  assert.notEqual(after.cardNonce, before.cardNonce);
  round.removeParticipant('alice', 3800);
  assert.equal(round.viewFor('host', 3800)!.resultReason, 'players');
});

test('changing lobby mode clears readiness and cannot alter an active round', () => {
  const round = create();
  act(round, 'host', 0, { kind: 'ready', contentHash });
  assert.equal(round.setLobbyMode('classic'), true);
  assert.deepEqual(round.viewFor('host', 0)!.ready, []);
  assert.equal(round.viewFor('host', 0)!.mode, 'classic');
  start(round);
  assert.equal(round.setLobbyMode('pass-n-play'), false);
  correct(round, 3000);
  assert.equal(round.viewFor('alice', 3600)!.phase, 'playing');
  assert.equal(round.viewFor('alice', 3600)!.guesserId, 'alice');
});

test('the host-selected starting player takes the first turn before rotation begins', () => {
  const round = create();
  act(round, 'alice', 0, { kind: 'ready', contentHash });
  assert.equal(round.setLobbyGuesser('bob'), true);
  assert.deepEqual(round.viewFor('host', 0)!.ready, []);
  start(round);
  assert.equal(round.viewFor('bob', 3000)!.canAnswer, true);
  assert.equal(round.viewFor('alice', 3000)!.canAnswer, false);
  correct(round, 3000);
  assert.equal(round.viewFor('host', 3600)!.guesserId, 'host');
});

test('two live clients synchronize mode, rotate turns and recover handoff snapshots', async (context) => {
  let now = 1000;
  context.mock.method(performance, 'now', () => now);
  const clients = new Map<string, LiveGame>();
  const deliveries: Promise<void>[] = [];
  let sequence = 0;
  const roster: SharePlaySnapshot = { revision: 1, status: 'joined', sessionId: 'session',
    localParticipantId: 'guest', participantIds: ['host', 'guest'], isHost: false, hostParticipantId: 'host',
    activity: { protocolVersion: 4, environment: 'test', nonce: 'activity', deckId: 'deck',
      deckTitle: 'Deck', durationSeconds: 30, hostPublicKey: 'key' } };
  const flush = async () => {
    for (let i = 0; i < 12; i++) { await Promise.all(deliveries.splice(0)); await Promise.resolve(); }
  };
  for (const id of ['host', 'guest']) clients.set(id, new LiveGame({ environment: 'test',
    uuid: () => `live-${++sequence}`, digest: async () => contentHash,
    cards: () => [{ answer: 'SECRET', byline: '' }, { answer: 'NEXT SECRET', byline: '' }],
    availableDeckIds: () => ['deck'], onDecks: () => undefined, onView: () => undefined,
    onActive: () => undefined, onLobby: () => undefined, onError: (error) => { throw new Error(error); },
    send: async (body, recipients) => { for (const recipient of recipients)
      deliveries.push(Promise.resolve().then(() => clients.get(recipient)!.receive({
        sessionId: 'session', senderId: id, senderIsHost: id === 'host', body }))); },
  }));
  const host = clients.get('host')!;
  const guest = clients.get('guest')!;
  host.setSession({ ...roster, localParticipantId: 'host', isHost: true }); guest.setSession(roster);
  await flush();
  host.selectMode('pass-n-play'); await flush();
  assert.equal(guest.currentView!.mode, 'pass-n-play');
  guest.selectMode('classic'); assert.equal(guest.currentView!.mode, 'pass-n-play');
  host.act('ready'); guest.act('ready'); await flush(); host.act('start'); await flush();
  now = 4000; host.pulse(); await flush();
  guest.act('answer', 'correct'); await flush();
  now = 4600; host.pulse(); await flush();
  assert.equal(host.currentView!.phase, 'handoff');
  assert.equal(host.currentView!.guesserId, 'host');
  guest.act('reveal'); await flush(); assert.equal(host.currentView!.phase, 'handoff');
  guest.setForeground(false); guest.setForeground(true); await flush();
  assert.equal(guest.currentView!.phase, 'handoff');
  host.act('reveal'); await flush();
  assert.ok(host.currentView!.card);
  assert.equal(guest.currentView!.card, null);
  const previousRoundId = host.currentView!.roundId;
  guest.returnToLobby(); await flush();
  assert.equal(host.currentView!.phase, 'playing');
  host.returnToLobby(); await flush();
  for (const client of [host, guest]) {
    assert.equal(client.currentView!.phase, 'lobby');
    assert.notEqual(client.currentView!.roundId, previousRoundId);
    assert.deepEqual(client.currentView!.ready, []);
    assert.equal(client.currentView!.score, 0);
    assert.equal(client.currentView!.card, null);
    assert.equal(client.currentView!.mode, 'pass-n-play');
  }
  host.selectDuration(45); await flush();
  assert.equal(guest.currentView!.durationSeconds, 45);
});

test('replacing a clue giver keeps the card because the replacement has not seen it', () => {
  const round = create(); start(round);
  const answer = round.viewFor('alice', 3000)!.card;
  assert.equal(round.viewFor('host', 3000)!.card, null);
  round.removeParticipant('alice', 3100);
  assert.deepEqual(round.viewFor('host', 3100)!.card, answer);
  assert.equal(round.viewFor('bob', 3100)!.card, null);
});
