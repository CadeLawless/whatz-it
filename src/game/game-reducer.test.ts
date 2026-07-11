import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { initialRoundState, roundReducer } from './game-reducer';
import { clampRoundDuration, formatRoundClock } from './round-duration';
import { shuffle } from './shuffle';

describe('roundReducer', () => {
  it('configures and starts a timed round', () => {
    const configured = roundReducer(initialRoundState, {
      type: 'CONFIGURE',
      deckId: 'animals',
      durationSeconds: 90,
      cardOrder: ['one', 'two'],
    });
    const started = roundReducer(configured, { type: 'START', now: 1_000 });

    assert.equal(configured.status, 'ready');
    assert.equal(started.status, 'playing');
    assert.equal(started.endsAt, 91_000);
  });

  it('records only one result until feedback advances', () => {
    const playing = {
      ...initialRoundState,
      status: 'playing' as const,
      deckId: 'animals',
      cardOrder: ['one', 'two'],
    };
    const answered = roundReducer(playing, { type: 'ANSWER', outcome: 'correct', now: 2_000 });
    const duplicate = roundReducer(answered, { type: 'ANSWER', outcome: 'passed', now: 2_100 });
    const advanced = roundReducer(duplicate, { type: 'ADVANCE' });

    assert.equal(answered.status, 'feedback');
    assert.equal(duplicate.results.length, 1);
    assert.equal(advanced.status, 'playing');
    assert.equal(advanced.currentCardIndex, 1);
  });

  it('finishes after answering the final card', () => {
    const playing = {
      ...initialRoundState,
      status: 'playing' as const,
      deckId: 'animals',
      cardOrder: ['only-card'],
    };
    const answered = roundReducer(playing, { type: 'ANSWER', outcome: 'passed', now: 3_000 });
    const finished = roundReducer(answered, { type: 'ADVANCE' });

    assert.equal(finished.status, 'finished');
    assert.equal(finished.results[0].outcome, 'passed');
  });

  it('ignores repeated finish actions', () => {
    const ready = { ...initialRoundState, status: 'ready' as const };
    const finished = roundReducer(ready, { type: 'FINISH' });
    assert.strictEqual(roundReducer(finished, { type: 'FINISH' }), finished);
  });
});

describe('shuffle', () => {
  it('does not mutate the source and preserves all cards', () => {
    const source = ['one', 'two', 'three'];
    const shuffled = shuffle(source, () => 0);

    assert.deepEqual(source, ['one', 'two', 'three']);
    assert.deepEqual([...shuffled].sort(), [...source].sort());
    assert.notStrictEqual(shuffled, source);
  });
});

describe('round duration', () => {
  it('never allows a duration above five minutes', () => {
    assert.equal(clampRoundDuration(301), 300);
    assert.equal(clampRoundDuration(9_999), 300);
  });

  it('never allows a duration below 30 seconds', () => {
    assert.equal(clampRoundDuration(29), 30);
  });

  it('formats gameplay time as minutes and seconds', () => {
    assert.equal(formatRoundClock(300), '5:00');
    assert.equal(formatRoundClock(90), '1:30');
    assert.equal(formatRoundClock(9), '0:09');
    assert.equal(formatRoundClock(0), '0:00');
  });
});
