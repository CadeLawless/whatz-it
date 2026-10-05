import assert from 'node:assert/strict';
import test from 'node:test';
import { RemoteClock } from './remote-clock';

test('clock samples prefer the smallest network delay and expire independently', () => {
  const clock = new RemoteClock();
  // Asymmetric network delays skew the slower samples; the fast sample wins.
  assert.equal(clock.begin('slow', 0), true);
  assert.equal(clock.reply('slow', 5300, 5300, 400), true);
  assert.equal(clock.begin('fast', 1000), true);
  assert.equal(clock.reply('fast', 6010, 6012, 1022), true);
  assert.equal(clock.hostNow(1100), null);
  assert.equal(clock.begin('medium', 2000), true);
  assert.equal(clock.reply('medium', 7100, 7100, 2150), true);
  assert.equal(clock.hostNow(2200), 7200);
  assert.equal(clock.hostNow(30400), null);
});

test('pending clock probes are bounded and recover after a timeout', () => {
  const clock = new RemoteClock();
  for (let index = 0; index < 8; index++) assert.equal(clock.begin(`probe-${index}`, 0), true);
  assert.equal(clock.begin('overflow', 0), false);
  assert.equal(clock.begin('probe-0', 1), false);
  assert.equal(clock.begin('replacement', 5001), true);
  assert.equal(clock.reply('probe-0', 5010, 5010, 5020), false);
  assert.equal(clock.reply('replacement', 6011, 6011, 5021), true);
});

test('invalid, slow, expired, and duplicate replies never calibrate the clock', () => {
  const samples = [
    { received: -1, sent: 0, local: 1 },
    { received: 100, sent: 99, local: 1 },
    { received: 100, sent: 102, local: 1 },
    { received: 100, sent: 100, local: -1 },
    { received: 100, sent: 100, local: 1001 },
    { received: 100, sent: 5100, local: 5001 },
    { received: Number.NaN, sent: 100, local: 1 },
    { received: 100, sent: Number.POSITIVE_INFINITY, local: 1 },
    { received: Number.MAX_VALUE, sent: Number.MAX_VALUE, local: 1 },
  ];
  for (const sample of samples) {
    const clock = new RemoteClock();
    for (let index = 0; index < 3; index++) {
      const nonce = String(index);
      assert.equal(clock.begin(nonce, 0), true);
      assert.equal(clock.reply(nonce, sample.received, sample.sent, sample.local), false);
      assert.equal(clock.reply(nonce, 10, 10, 20), false);
    }
    assert.equal(clock.hostNow(6000), null);
  }
});

test('high latency alone cannot enable a synchronized clock', () => {
  const clock = new RemoteClock();
  for (let index = 0; index < 3; index++) {
    const now = index * 1000;
    assert.equal(clock.begin(String(index), now), true);
    assert.equal(clock.reply(String(index), now + 5500, now + 5500, now + 1000), true);
  }
  assert.equal(clock.hostNow(4000), null);
});
