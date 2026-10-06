import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteView } from './remote-round';
import { SharePlayRoundCues } from './round-cues';

const view = (phase: RemoteView['phase'], patch: Partial<RemoteView> = {}) => ({
  sessionId: 'session', roundId: 'round', phase, startsAt: 3000, deadline: 78000,
  revision: 1, feedback: null, ...patch,
}) as RemoteView;

test('the next card plays the flip once while final timer cues continue', () => {
  const cues = new SharePlayRoundCues();
  cues.next(view('feedback', { mode: 'pass-n-play', feedback: 'correct' }), 0, 12000);
  assert.deepEqual(cues.next(view('playing', { mode: 'pass-n-play' }), 0, 10000),
    [{ sound: 'flip', haptic: 'card-flip' }, { sound: 'final-tick', haptic: 'final-countdown' }]);
  assert.deepEqual(cues.next(view('playing', { mode: 'pass-n-play' }), 0, 10000), []);
});

test('countdown, answers, flips and end cues are shared once despite repeated snapshots', () => {
  const cues = new SharePlayRoundCues();
  assert.deepEqual(cues.next(view('countdown'), 3, 75000), [
    { sound: 'count-3', haptic: 'initial-countdown', countdownValue: 3 },
  ]);
  assert.deepEqual(cues.next(view('countdown', { revision: 2 }), 3, 75000), []);
  assert.equal(cues.next(view('countdown'), 2, 75000)[0].sound, 'count-2');
  assert.equal(cues.next(view('countdown'), 1, 75000)[0].sound, 'count-1');
  assert.deepEqual(cues.next(view('playing'), 0, 75000), [{ sound: 'round-start' }]);
  assert.deepEqual(cues.next(view('feedback', { feedback: 'correct' }), 0, 74000),
    [{ sound: 'correct', haptic: 'correct' }]);
  assert.deepEqual(cues.next(view('feedback', { feedback: 'correct', revision: 4 }), 0, 74000), []);
  assert.deepEqual(cues.next(view('playing'), 0, 73500), [{ sound: 'flip', haptic: 'card-flip' }]);
  assert.deepEqual(cues.next(view('feedback', { feedback: 'pass' }), 0, 73000),
    [{ sound: 'pass', haptic: 'pass' }]);
  assert.deepEqual(cues.next(view('results'), 0, 0), [{ sound: 'round-end', haptic: 'times-up' }]);
  assert.deepEqual(cues.next(view('results', { revision: 8 }), 0, 0), []);
});

test('final ticks follow displayed seconds without replaying missed seconds', () => {
  const cues = new SharePlayRoundCues();
  assert.deepEqual(cues.next(view('playing'), 0, 10000), [{ sound: 'final-tick', haptic: 'final-countdown' }]);
  assert.deepEqual(cues.next(view('playing'), 0, 9500), []);
  assert.deepEqual(cues.next(view('playing'), 0, 7000), [{ sound: 'final-tick', haptic: 'final-countdown' }]);
  assert.deepEqual(cues.next(view('playing'), 0, 7500), [{ sound: 'final-tick', haptic: 'final-countdown' }]);
  assert.deepEqual(cues.next(view('playing'), 0, 7000), []);
  assert.deepEqual(cues.next(view('paused'), 0, 7000), []);
  assert.equal(cues.next(view('countdown', { startsAt: 9000 }), 3, 7000)[0].sound, 'count-3');
  assert.equal(cues.next(view('playing', { deadline: 16000 }), 0, 7000).at(-1)?.sound, 'final-tick');
});

test('late joins and temporary missing views do not replay previous answers or results', () => {
  const cues = new SharePlayRoundCues();
  assert.deepEqual(cues.next(view('feedback', { feedback: 'pass' }), 0, 70000), []);
  assert.deepEqual(cues.next(null, 0, 0), []);
  assert.deepEqual(cues.next(view('feedback', { feedback: 'pass' }), 0, 70000), []);
  assert.deepEqual(cues.next(view('results', { roundId: 'new-round' }), 0, 0), []);
});
