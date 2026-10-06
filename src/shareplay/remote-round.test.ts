import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRemoteIntent, RemoteRound, type RemoteView } from './remote-round';
import { parseRemoteView } from './game-wire';
import { RemoteClock } from './remote-clock';
import { SimulatedTransport } from './simulated-transport';

const contentHash = 'a'.repeat(64);
function create(participants = ['host', 'guesser'], cardCount = 3) {
  let nonce = 0;
  return new RemoteRound({
    sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'round', participants,
    guesserId: 'guesser', durationSeconds: 30,
    deck: { deckId: 'deck', contentHash, sponsorId: 'host' },
    cards: Array.from({ length: cardCount }, (_, index) => ({ answer: `SECRET-${index}`, byline: `HINT-${index}` })),
  }, () => `nonce-${++nonce}`);
}
let intentSequence = 0;
function command(round: RemoteRound, sender: string, now: number, payload: Record<string, unknown>) {
  return JSON.stringify({
    protocol: 1, sessionId: 'session', environment: 'test', roundId: 'round',
    intentId: `intent-${++intentSequence}`, revision: round.viewFor(sender, now)?.revision ?? 0, ...payload,
  });
}
function start(round: RemoteRound, participants = ['host', 'guesser']) {
  for (const id of participants) if (!round.viewFor(id, 0)?.ready.includes(id))
    assert.equal(round.receive(id, command(round, id, 0, { kind: 'ready', contentHash }), 0), 'accepted');
  assert.equal(round.receive('host', command(round, 'host', 0, { kind: 'start' }), 0), 'accepted');
}

test('a prepared round can resume after its deck owner leaves, once all remaining players ready again', () => {
  const participants = ['host', 'guesser', 'owner'];
  const round = new RemoteRound({ sessionId: 'session', environment: 'test', hostId: 'host',
    roundId: 'round', participants, guesserId: 'guesser', durationSeconds: 30,
    deck: { deckId: 'deck', contentHash, sponsorId: 'owner' },
    cards: [{ answer: 'ANSWER', byline: '' }] }, () => 'card-nonce');
  start(round, participants);
  round.removeParticipant('owner', 3000);
  assert.equal(round.viewFor('host', 3000)?.phase, 'playing');
  assert.equal(round.receive('host', command(round, 'host', 3001, { kind: 'pause' }), 3001), 'accepted');
  assert.equal(round.receive('host', command(round, 'host', 3002, { kind: 'ready', contentHash }), 3002), 'accepted');
  assert.equal(round.receive('host', command(round, 'host', 3002, { kind: 'resume' }), 3002), 'rejected');
  assert.equal(round.receive('guesser', command(round, 'guesser', 3003, { kind: 'ready', contentHash }), 3003), 'accepted');
  assert.equal(round.receive('host', command(round, 'host', 3003, { kind: 'resume' }), 3003), 'accepted');
  assert.equal(round.viewFor('host', 3003)?.phase, 'countdown');
});

test('guesser projections never contain card content before results; controls follow roles', () => {
  const round = create(); start(round);
  assert.equal(round.viewFor('host', 2999)?.card, null);
  for (const time of [0, 2999, 3000]) {
    const view = round.viewFor('guesser', Math.max(2999, time))!;
    assert.equal(view.card, null); assert.equal(view.results, null);
    assert.doesNotMatch(JSON.stringify(view), /SECRET|HINT/);
  }
  assert.equal(round.viewFor('host', 3000)?.card?.answer, 'SECRET-0');
  assert.equal(round.viewFor('guesser', 3000)?.canAnswer, true);
  assert.ok(round.viewFor('guesser', 3000)?.cardNonce);
  assert.equal(round.viewFor('stranger', 3000), null);
  const snapshot = round.viewFor('host', 3000)!;
  snapshot.card!.answer = 'tampered'; snapshot.participants.length = 0;
  assert.equal(round.viewFor('host', 3000)?.card?.answer, 'SECRET-0');
});

test('an initiating host can take a turn guessing without an answer in its view', () => {
  const round = new RemoteRound({
    sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'round',
    participants: ['host', 'guest'], guesserId: 'host',
    durationSeconds: 30, deck: { deckId: 'deck', contentHash, sponsorId: 'host' },
    cards: [{ answer: 'HIDDEN FROM HOST VIEW', byline: 'HIDDEN BYLINE' }],
  }, () => 'token');
  start(round, ['host', 'guest']);
  const hostView = round.viewFor('host', 3000)!;
  assert.equal(hostView.card, null);
  assert.equal(hostView.cardNonce, 'token');
  assert.equal(hostView.canAnswer, true);
  assert.doesNotMatch(JSON.stringify(hostView), /HIDDEN FROM HOST VIEW|HIDDEN BYLINE/);
  assert.equal(round.viewFor('guest', 3000)?.card?.answer, 'HIDDEN FROM HOST VIEW');
});

test('duplicate and competing taps apply once; feedback consumes time and invalidates the old nonce', () => {
  const round = create(); start(round);
  const cardNonce = round.viewFor('guesser', 3000)!.cardNonce;
  const answer = command(round, 'guesser', 3000, { kind: 'answer', outcome: 'correct', cardNonce });
  assert.equal(round.receive('host', answer, 3000), 'rejected');
  assert.equal(round.receive('guesser', answer, 3000), 'accepted');
  assert.equal(round.receive('guesser', answer, 3100), 'duplicate');
  assert.equal(round.receive('guesser', command(round, 'guesser', 3100, { kind: 'answer', outcome: 'pass', cardNonce }), 3100), 'rejected');
  assert.equal(round.viewFor('host', 3599)?.card, null);
  assert.notEqual(round.viewFor('guesser', 3600)?.cardNonce, cardNonce);
  assert.equal(round.receive('guesser', command(round, 'guesser', 3600, { kind: 'answer', outcome: 'correct', cardNonce }), 3600), 'rejected');
  assert.equal(round.viewFor('guesser', 3600)?.score, 1);
  assert.equal(round.viewFor('host', 3600)?.remainingMs, 29400);
});

test('expiry wins against answers and pause, including without a timer tick arriving first', () => {
  const round = create(); start(round);
  const cardNonce = round.viewFor('guesser', 3000)!.cardNonce;
  const late = command(round, 'guesser', 3000, { kind: 'answer', outcome: 'correct', cardNonce });
  assert.equal(round.receive('guesser', late, 33000), 'rejected');
  assert.equal(round.receive('host', command(round, 'host', 33000, { kind: 'pause' }), 33000), 'rejected');
  assert.equal(round.viewFor('guesser', 33000)?.phase, 'results');
  assert.equal(round.viewFor('host', 33000)?.score, 0);
  const revision = round.viewFor('host', 33000)!.revision;
  assert.equal(round.viewFor('host', 34000)?.revision, revision);
});

test('readiness requires matching deck content and every participant; resume requires fresh readiness', () => {
  const round = create();
  assert.equal(round.receive('guesser', command(round, 'guesser', 0, { kind: 'ready', contentHash: 'b'.repeat(64) }), 0), 'rejected');
  assert.equal(round.receive('host', command(round, 'host', 0, { kind: 'start' }), 0), 'rejected');
  start(round);
  assert.equal(round.receive('host', command(round, 'host', 5000, { kind: 'pause' }), 5000), 'accepted');
  assert.equal(round.viewFor('host', 5000)?.card, null);
  assert.equal(round.viewFor('host', 5000)?.remainingMs, 28000);
  assert.equal(round.receive('host', command(round, 'host', 6000, { kind: 'resume' }), 6000), 'rejected');
  for (const id of ['host', 'guesser']) round.receive(id, command(round, id, 6000, { kind: 'ready', contentHash }), 6000);
  assert.equal(round.receive('host', command(round, 'host', 6000, { kind: 'resume' }), 6000), 'accepted');
  assert.equal(round.viewFor('host', 6000)?.deadline, 37000);
  assert.equal(round.viewFor('host', 8999)?.card, null);
  assert.equal(round.viewFor('host', 9000)?.phase, 'playing');
});

test('readiness from before a pause cannot acknowledge the new paused state', () => {
  const round = create();
  const delayedReady = command(round, 'guesser', 0, { kind: 'ready', contentHash });
  start(round);
  assert.equal(round.receive('host', command(round, 'host', 4000, { kind: 'pause' }), 4000), 'accepted');
  assert.equal(round.receive('guesser', delayedReady, 4000), 'rejected');
  assert.deepEqual(round.viewFor('host', 4000)?.ready, []);

  // Both players can still acknowledge the same paused snapshot concurrently.
  const hostReady = command(round, 'host', 4000, { kind: 'ready', contentHash });
  const guestReady = command(round, 'guesser', 4000, { kind: 'ready', contentHash });
  assert.equal(round.receive('host', hostReady, 4000), 'accepted');
  assert.equal(round.receive('guesser', guestReady, 4000), 'accepted');
  assert.equal(round.receive('host', command(round, 'host', 4000, { kind: 'resume' }), 4000), 'accepted');
});

test('a roster change keeps readiness from remaining players', () => {
  const round = create(['host', 'guesser', 'clue']);
  const delayedReady = command(round, 'guesser', 0, { kind: 'ready', contentHash });
  round.removeParticipant('clue', 0);
  assert.equal(round.receive('guesser', delayedReady, 0), 'accepted');
  const hostReady = command(round, 'host', 0, { kind: 'ready', contentHash });
  const guestReady = command(round, 'guesser', 0, { kind: 'ready', contentHash });
  assert.equal(round.receive('host', hostReady, 0), 'accepted');
  assert.equal(round.receive('guesser', guestReady, 0), 'rejected');
  assert.equal(round.receive('host', command(round, 'host', 0, { kind: 'start' }), 0), 'accepted');
});

test('changing the lobby timer keeps the round visible and preserves readiness', () => {
  const round = create();
  const delayedReady = command(round, 'guesser', 0, { kind: 'ready', contentHash });
  assert.equal(round.receive('host', command(round, 'host', 0, { kind: 'ready', contentHash }), 0), 'accepted');
  const before = round.viewFor('host', 0)!;
  assert.equal(round.setLobbyDuration(75), true);
  const after = round.viewFor('host', 0)!;
  assert.equal(after.roundId, before.roundId);
  assert.equal(after.phase, 'lobby');
  assert.equal(after.durationSeconds, 75);
  assert.equal(after.remainingMs, 75000);
  assert.deepEqual(after.ready, ['host']);
  assert.equal(round.receive('guesser', delayedReady, 0), 'accepted');
  assert.equal(round.setLobbyDuration(75), false);
  assert.equal(round.viewFor('host', 0)?.revision, after.revision + 1);
});

test('changing the lobby guesser keeps the round visible and updates card visibility', () => {
  const round = create();
  const delayedReady = command(round, 'guesser', 0, { kind: 'ready', contentHash });
  assert.equal(round.receive('host', command(round, 'host', 0, { kind: 'ready', contentHash }), 0), 'accepted');
  const before = round.viewFor('host', 0)!;
  assert.equal(round.setLobbyGuesser('host'), true);
  const after = round.viewFor('host', 0)!;
  assert.equal(after.roundId, before.roundId);
  assert.equal(after.phase, 'lobby');
  assert.equal(after.guesserId, 'host');
  assert.deepEqual(after.ready, ['host']);
  assert.ok(after.revision > before.revision);
  assert.equal(round.receive('guesser', delayedReady, 0), 'accepted');
  assert.equal(round.setLobbyGuesser('host'), false);
  assert.equal(round.setLobbyGuesser('stranger'), false);
  start(round);
  assert.equal(round.viewFor('host', 3000)?.card, null);
  assert.equal(round.viewFor('guesser', 3000)?.card?.answer, 'SECRET-0');
});

test('a member can pause after a missed countdown transition, but cannot resume with stale controls', () => {
  const round = create(); start(round);
  const pause = command(round, 'guesser', 2999, { kind: 'pause' });
  const staleResume = command(round, 'host', 2999, { kind: 'resume' });
  assert.equal(round.receive('stranger', pause, 3000), 'rejected');
  // receive advances from countdown to playing, increasing the revision first.
  assert.equal(round.receive('guesser', pause, 3000), 'accepted');
  assert.equal(round.viewFor('host', 3000)?.phase, 'paused');
  assert.equal(round.viewFor('host', 3000)?.card, null);
  assert.equal(round.viewFor('host', 3000)?.remainingMs, 30000);
  for (const id of ['host', 'guesser']) round.receive(id, command(round, id, 3000, { kind: 'ready', contentHash }), 3000);
  assert.equal(round.receive('host', staleResume, 3000), 'rejected');
  assert.equal(round.receive('host', command(round, 'host', 3000, { kind: 'resume' }), 3000), 'accepted');
});

test('projections copy only approved card and deck fields from runtime objects', () => {
  const deck = { deckId: 'deck', contentHash, sponsorId: 'host', futureAnswers: ['UNEXPECTED SECRET'] };
  const card = { answer: 'Allowed answer', byline: 'Allowed byline', futureAnswers: ['UNEXPECTED SECRET'] };
  const round = new RemoteRound({
    sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'round',
    participants: ['host', 'guesser'], guesserId: 'guesser', durationSeconds: 30,
    deck, cards: [card],
  }, () => 'opaque-token');
  start(round);
  for (const id of ['host', 'guesser']) assert.doesNotMatch(JSON.stringify(round.viewFor(id, 3000)), /UNEXPECTED SECRET|futureAnswers/);
  const cardNonce = round.viewFor('guesser', 3000)!.cardNonce;
  assert.equal(round.receive('guesser', command(round, 'guesser', 3000, { kind: 'answer', outcome: 'correct', cardNonce }), 3000), 'accepted');
  assert.deepEqual(round.viewFor('guesser', 3000)?.results, [{ answer: card.answer, byline: card.byline, outcome: 'correct' }]);
});

test('a departing guesser hands the running round to another player', () => {
  const round = create(['host', 'guesser', 'clue']); start(round, ['host', 'guesser', 'clue']);
  round.removeParticipant('guesser', 4000);
  assert.equal(round.viewFor('host', 4000)?.phase, 'playing');
  assert.equal(round.viewFor('host', 4000)?.card?.answer, 'SECRET-1');
  assert.equal(round.viewFor('host', 4000)?.guesserId, 'clue');
  assert.deepEqual(new Set(round.viewFor('host', 4000)?.ready), new Set(['host', 'clue']));
  assert.equal(round.viewFor('guesser', 4000), null);
  round.addParticipant('returning', 4500);
  assert.equal(round.viewFor('returning', 4500)?.phase, 'playing');
  assert.equal(round.viewFor('returning', 4500)?.guesserId, 'clue');
});

test('the round ends when a departure leaves only one player', () => {
  const round = create(); start(round);
  round.removeParticipant('guesser', 4000);
  assert.equal(round.viewFor('host', 4000)?.phase, 'results');
  assert.equal(round.viewFor('host', 4000)?.resultReason, 'players');
  assert.equal(round.viewFor('host', 4000)?.remainingMs, 0);
  assert.equal(round.viewFor('guesser', 4000), null);
});

test('results identify a timer expiration separately from running out of cards', () => {
  const timed = create(); start(timed);
  assert.equal(timed.viewFor('host', 3000)?.card?.answer, 'SECRET-0');
  assert.equal(timed.viewFor('host', 33000)?.resultReason, 'time');
  assert.deepEqual(timed.viewFor('guesser', 33000)?.results, [
    { answer: 'SECRET-0', byline: 'HINT-0', outcome: 'neutral' },
  ]);
  assert.equal(timed.viewFor('guesser', 33000)?.score, 0);
  assert.ok(parseRemoteView(timed.viewFor('guesser', 33000), 'session', 'guesser'));
  assert.equal(parseRemoteView({ ...timed.viewFor('guesser', 33000), resultReason: null },
    'session', 'guesser'), null);
  assert.equal(timed.viewFor('host', 34000)?.results?.length, 1);

  const exhausted = create(['host', 'guesser'], 1); start(exhausted);
  const nonce = exhausted.viewFor('guesser', 3000)?.cardNonce;
  assert.equal(exhausted.receive('guesser', command(exhausted, 'guesser', 3000,
    { kind: 'answer', outcome: 'correct', cardNonce: nonce }), 3000), 'accepted');
  assert.equal(exhausted.viewFor('host', 3000)?.resultReason, 'cards');
  assert.ok(parseRemoteView(exhausted.viewFor('guesser', 3000), 'session', 'guesser'));
});

test('a separate deck owner can leave without interrupting an active round', () => {
  const round = new RemoteRound({
    sessionId: 'session', environment: 'test', hostId: 'host', roundId: 'round',
    participants: ['host', 'guesser', 'owner'], guesserId: 'guesser', durationSeconds: 30,
    deck: { deckId: 'paid-deck', contentHash, sponsorId: 'owner' },
    cards: [{ answer: 'PAID ANSWER', byline: 'PAID HINT' }],
  }, () => 'opaque-token');
  start(round, ['host', 'guesser', 'owner']);
  assert.equal(round.viewFor('host', 3000)?.card?.answer, 'PAID ANSWER');
  assert.doesNotMatch(JSON.stringify(round.viewFor('guesser', 3000)), /PAID ANSWER|PAID HINT/);
  round.removeParticipant('owner', 4000);
  assert.equal(round.viewFor('host', 4000)?.phase, 'playing');
  assert.equal(round.viewFor('host', 4000)?.card?.answer, 'PAID ANSWER');
  assert.ok(parseRemoteView(round.viewFor('guesser', 4000), 'session', 'guesser'));
});

test('schema rejects unknown fields, bad versions, malformed outcomes, and stale session messages', () => {
  const round = create(); start(round);
  const valid = JSON.parse(command(round, 'host', 3000, { kind: 'answer', cardNonce: 'nonce-1', outcome: 'correct' }));
  for (const patch of [{ senderId: 'host' }, { protocol: 2 }, { outcome: 'win' }, { revision: -1 }, { cardNonce: '' }]) {
    assert.equal(parseRemoteIntent(JSON.stringify({ ...valid, ...patch })), null);
  }
  assert.equal(parseRemoteIntent('x'.repeat(2049)), null);
  assert.equal(parseRemoteIntent('null'), null);
  for (const patch of [{ sessionId: 'old' }, { environment: 'production' }, { roundId: 'old' }]) {
    assert.equal(round.receive('host', JSON.stringify({ ...valid, ...patch }), 3000), 'rejected');
  }
});

for (const playerCount of [2, 8, 32]) test(`${playerCount} clients converge after delay, duplicates, lost snapshots and recovery`, () => {
  const ids = ['host', 'guesser', ...Array.from({ length: playerCount - 2 }, (_, i) => `clue-${i}`)];
  const round = create(ids, 1); start(round, ids);
  const network = new SimulatedTransport();
  const views = new Map<string, RemoteView>();
  const publish = (dropGuesser = false) => {
    for (const id of ids) network.send('host', id, JSON.stringify(round.viewFor(id, network.now)), { delay: 20, drop: dropGuesser && id === 'guesser' });
  };
  for (const id of ids) network.connect(id, (sender, body) => {
    if (id === 'host' && parseRemoteIntent(body)) { round.receive(sender, body, network.now); publish(true); return; }
    // Snapshot admission is bound to the known host and monotonically increasing revision.
    const view = JSON.parse(body) as RemoteView;
    if (sender === 'host' && view.sessionId === 'session' && view.roundId === 'round' && view.revision > (views.get(id)?.revision ?? -1)) views.set(id, view);
  });
  network.advance(3000); publish(); network.advance(3020);
  const previous = JSON.stringify(views.get('guesser'));
  const answer = command(round, 'guesser', network.now, { kind: 'answer', outcome: 'correct', cardNonce: views.get('guesser')!.cardNonce });
  network.send('guesser', 'host', answer, { delay: 80, duplicate: true });
  network.advance(3200);
  assert.equal(views.get('guesser')?.score, 0); // Its results packet was deliberately lost.
  publish(); network.advance(3220);
  network.send('host', 'guesser', previous); network.advance(3220);
  for (const view of views.values()) {
    assert.equal(view.phase, 'results'); assert.equal(view.score, 1);
    assert.deepEqual(view.results, [{ answer: 'SECRET-0', byline: 'HINT-0', outcome: 'correct' }]);
  }
  network.send('host', 'guesser', previous, { delay: 100 });
  network.disconnect('guesser'); network.advance(3400);
});

test('clock calibration handles clock skew, ignores unsolicited replies, and expires after backgrounding', () => {
  const clock = new RemoteClock();
  assert.equal(clock.reply('unknown', 0, 0, 0), false);
  for (let i = 0; i < 3; i++) {
    clock.begin(String(i), 100 + i * 100);
    assert.equal(clock.reply(String(i), 5110 + i * 100, 5112 + i * 100, 122 + i * 100), true);
    assert.equal(clock.reply(String(i), 5110, 5112, 322), false);
  }
  assert.equal(clock.hostNow(400), 5400);
  assert.equal(clock.hostNow(31000), null);
  clock.reset(); assert.equal(clock.hostNow(400), null);
});
