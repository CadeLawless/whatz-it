import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { RoundHapticCue } from '../utils/round-haptics';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/utils/round-haptics.ts'), {
  configFile: false, babelrc: false,
  presets: [['babel-preset-expo', { worklets: false }]],
});

function harness(platform: 'android' | 'ios', impact: () => Promise<void> = async () => {}) {
  const calls: { api: string; value?: unknown }[] = [];
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const exported = {} as typeof import('../utils/round-haptics');
  runInNewContext(code, {
    exports: exported, Date,
    setTimeout(callback: () => void, milliseconds: number) {
      assert.equal(milliseconds, 80, 'only the existing multi-impact spacing is scheduled');
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout(id: number) { timers.delete(id); },
    require(name: string) {
      switch (name) {
        case 'expo-haptics': return {
          ImpactFeedbackStyle: { Medium: 'medium', Heavy: 'heavy', Light: 'light', Rigid: 'rigid' },
          impactAsync(style: string) {
            calls.push({ api: 'impact', value: style });
            return impact();
          },
          performAndroidHapticsAsync() { assert.fail('unsupported View haptics must not be used'); },
        };
        case 'react-native': return {
          Platform: { OS: platform },
          Vibration: {
            cancel() { calls.push({ api: 'cancel' }); },
            vibrate(pattern: unknown) {
              calls.push({ api: 'vibrate', value: Array.isArray(pattern) ? Array.from(pattern) : pattern });
            },
          },
        };
        case 'whatz-it-video-export': return {
          async playRoundHaptic(cue: string, value: number | null) {
            calls.push({ api: 'ios', value: [cue, value] });
          },
        };
        default:
          if (name.endsWith('video-diagnostics')) return {
            logRoundDiagnostic() {},
            warnRoundDiagnostic() { calls.push({ api: 'failure' }); },
          };
          return require(name);
      }
    },
  });
  return {
    ...exported, calls, timers,
    advance() {
      const scheduled = [...timers.values()];
      timers.clear();
      scheduled.forEach((callback) => callback());
    },
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

const cases: { cue: RoundHapticCue; count?: 1 | 2 | 3; style?: string; pulses: number }[] = [
  { cue: 'correct', style: 'heavy', pulses: 1 },
  { cue: 'pass', style: 'medium', pulses: 1 },
  { cue: 'card-flip', style: 'medium', pulses: 1 },
  { cue: 'get-ready', style: 'medium', pulses: 2 },
  { cue: 'initial-countdown', count: 3, style: 'light', pulses: 1 },
  { cue: 'initial-countdown', count: 2, style: 'light', pulses: 2 },
  { cue: 'initial-countdown', count: 1, style: 'light', pulses: 3 },
  { cue: 'final-countdown', style: 'rigid', pulses: 1 },
  { cue: 'times-up', pulses: 3 },
];

for (const cameraActive of [false, true]) {
  for (const { cue, count, style, pulses } of cases) {
    test(`Android ${cue} ${count ?? ''}, recording=${cameraActive}: one intended pattern`, async () => {
      const h = harness('android');
      const pending = h.triggerRoundHaptic(cue, { cameraActive, countdownValue: count });
      await flush();
      for (let index = 1; style && index < pulses; index += 1) {
        assert.equal(h.timers.size, 1);
        h.advance();
        await flush();
      }
      await pending;
      assert.deepEqual(h.calls, style
        ? Array.from({ length: pulses }, () => ({ api: 'impact', value: style }))
        : [{ api: 'cancel' }, { api: 'vibrate', value: [0, 450, 150, 450, 150, 450] }]);
      assert.equal(h.timers.size, 0);
    });
  }
}

test('leaving during countdown cancels remaining impacts, but the next round can vibrate', async () => {
  const h = harness('android');
  const old = h.triggerRoundHaptic('initial-countdown', { cameraActive: true, countdownValue: 1 });
  await flush();
  assert.equal(h.timers.size, 1);
  h.cancelRoundHaptics();
  await old;
  assert.equal(h.timers.size, 0);
  const next = h.triggerRoundHaptic('get-ready', { cameraActive: false });
  await flush();
  h.advance();
  await next;
  assert.deepEqual(h.calls, [
    { api: 'impact', value: 'light' }, { api: 'cancel' },
    { api: 'impact', value: 'medium' }, { api: 'impact', value: 'medium' },
  ]);
});

test('a late native completion after cleanup cannot emit the rest of an old countdown', async () => {
  let complete!: () => void;
  const native = new Promise<void>((resolve) => { complete = resolve; });
  const h = harness('android', () => native);
  const old = h.triggerRoundHaptic('initial-countdown', { cameraActive: true, countdownValue: 1 });
  h.cancelRoundHaptics();
  complete();
  await flush();
  h.advance();
  await old;
  assert.deepEqual(h.calls, [{ api: 'impact', value: 'light' }, { api: 'cancel' }]);
});

test('gesture cues dispatch immediately without a timer or waiting for the preceding haptic', async () => {
  let complete!: () => void;
  const native = new Promise<void>((resolve) => { complete = resolve; });
  const h = harness('android', () => native);
  const correct = h.triggerRoundHaptic('correct', { cameraActive: true });
  const flip = h.triggerRoundHaptic('card-flip', { cameraActive: true });
  assert.deepEqual(h.calls, [{ api: 'impact', value: 'heavy' }, { api: 'impact', value: 'medium' }]);
  assert.equal(h.timers.size, 0);
  complete();
  await Promise.all([correct, flip]);
});

test('a failed Android call is handled without a second vibration attempt', async () => {
  const h = harness('android', async () => { throw new Error('unavailable'); });
  await h.triggerRoundHaptic('correct', { cameraActive: true });
  assert.deepEqual(h.calls, [{ api: 'impact', value: 'heavy' }, { api: 'failure' }]);
});

test('iOS retains exactly one native call per cue with and without recording', async () => {
  const h = harness('ios');
  const expected = [];
  for (const cameraActive of [false, true]) {
    for (const { cue, count } of cases) {
      await h.triggerRoundHaptic(cue, { cameraActive, countdownValue: count });
      expected.push({ api: 'ios', value: [cue, count ?? null] });
    }
  }
  assert.deepEqual(h.calls, expected);
  assert.equal(h.timers.size, 0);
});
