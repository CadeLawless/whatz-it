import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { androidHapticPattern } from './android-haptic-pattern';
import { AndroidHapticScheduler } from './android-haptic-scheduler';
import type { RoundHapticCue } from '../utils/round-haptics';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/utils/round-haptics.ts'), {
  configFile: false, babelrc: false,
  presets: [['babel-preset-expo', { worklets: false }]],
});

function harness(platform: 'android' | 'ios', native: 'available' | 'missing' | 'failed' = 'available') {
  const calls: { api: string; value?: unknown }[] = [];
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const exported = {} as typeof import('../utils/round-haptics');
  runInNewContext(code, {
    exports: exported, Date: { now: () => now },
    setTimeout() { assert.fail('native patterns must not schedule JS pulses'); },
    clearTimeout() {},
    require(name: string) {
      switch (name) {
        case 'expo-haptics': return { impactAsync() { assert.fail('unexpected Expo fallback'); } };
        case '../game/android-haptic-pattern': return { androidHapticPattern };
        case './android-gameplay-trace': return { traceAndroidGameplay() {} };
        case '../game/android-haptic-scheduler': return {
          AndroidHapticScheduler: class extends AndroidHapticScheduler {
            constructor(dispatch: ConstructorParameters<typeof AndroidHapticScheduler>[0]) {
              super(dispatch, () => now, (callback, ms) => {
                const id = ++nextId;
                timers.set(id, { at: now + ms, callback });
                return id as unknown as ReturnType<typeof setTimeout>;
              }, id => { timers.delete(id as unknown as number); });
            }
          },
        };
        case 'react-native': return {
          Platform: { OS: platform },
          Vibration: {
            cancel() { calls.push({ api: 'cancel' }); },
            vibrate(pattern: number[], repeat: boolean) {
              assert.equal(repeat, false);
              calls.push({ api: 'fallback', value: Array.from(pattern) });
            },
          },
        };
        case 'whatz-it-video-export': return {
          hasAndroidRoundHapticAmplitudeControl() { return false; },
          cancelAndroidRoundWaveform() { calls.push({ api: 'native-cancel' }); },
          playAndroidRoundWaveform(timings: number[], amplitudes: number[]) {
            if (native === 'missing') return false;
            calls.push({ api: 'waveform', value: { timings, amplitudes } });
            if (native === 'failed') throw new Error('unavailable');
            return true;
          },
          async playRoundHaptic(cue: string, value: number | null) {
            calls.push({ api: 'ios', value: [cue, value] });
          },
        };
        default:
          if (name.endsWith('video-diagnostics')) return {
            logRoundDiagnostic() {}, warnRoundDiagnostic() { calls.push({ api: 'failure' }); },
          };
          return require(name);
      }
    },
  });
  return { ...exported, calls, advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].callback();
    }
    now = end;
  } };
}

const cases: { cue: RoundHapticCue; count?: 1 | 2 | 3; timings: number[] }[] = [
  { cue: 'correct', timings: [0, 180] },
  { cue: 'pass', timings: [0, 90, 90, 90] },
  { cue: 'card-flip', timings: [0, 90] },
  { cue: 'get-ready', timings: [0, 110, 90, 110] },
  { cue: 'initial-countdown', count: 3, timings: [0, 100] },
  { cue: 'initial-countdown', count: 2, timings: [0, 100, 80, 100] },
  { cue: 'initial-countdown', count: 1, timings: [0, 100, 80, 100, 80, 100] },
  { cue: 'final-countdown', timings: [0, 100] },
  { cue: 'times-up', timings: [0, 450, 70, 450, 70, 450] },
];

for (const cameraActive of [false, true]) {
  for (const { cue, count, timings } of cases) {
    test(`Android ${cue} ${count ?? ''}, recording=${cameraActive}: one native waveform`, async () => {
      const h = harness('android');
      await h.triggerRoundHaptic(cue, { cameraActive, countdownValue: count });
      assert.equal(h.calls.length, 1);
      assert.equal(h.calls[0].api, 'waveform');
      const pattern = h.calls[0].value as ReturnType<typeof androidHapticPattern>;
      assert.deepEqual(pattern.timings, timings);
      assert.equal(pattern.amplitudes.length, timings.length);
      pattern.amplitudes.forEach((amplitude, i) => {
        assert.ok(i % 2 ? amplitude > 0 && amplitude <= 255 : amplitude === 0);
      });
    });
  }
}

test('cleanup stops the motor; a new round dispatches without a pending sequence', async () => {
  const h = harness('android');
  await h.triggerRoundHaptic('initial-countdown', { cameraActive: true, countdownValue: 1 });
  h.cancelRoundHaptics();
  await h.triggerRoundHaptic('get-ready', { cameraActive: false });
  assert.deepEqual(h.calls.map(c => c.api), ['waveform', 'native-cancel', 'cancel', 'waveform']);
});

test('ticks cannot interrupt answers; next-card feedback immediately replaces the answer', async () => {
  const h = harness('android');
  await h.triggerRoundHaptic('correct', { cameraActive: true });
  await h.triggerRoundHaptic('final-countdown', { cameraActive: true });
  assert.equal(h.calls.length, 1);
  await h.triggerRoundHaptic('card-flip', { cameraActive: true });
  assert.equal(h.calls.length, 2);
  h.advance(129);
  assert.equal(h.calls.length, 2);
  h.advance(1);
  assert.equal(h.calls.length, 3);
});

test('older binaries receive one duration-only waveform with identical pulse onsets', async () => {
  const h = harness('android', 'missing');
  await h.triggerRoundHaptic('initial-countdown', { cameraActive: false, countdownValue: 1 });
  assert.deepEqual(h.calls, [{ api: 'cancel' }, { api: 'fallback', value: [0, 100, 80, 100, 80, 100] }]);
});

test('an answer interrupts a clock tick immediately and replays the tick once', async () => {
  const h = harness('android');
  await h.triggerRoundHaptic('final-countdown', { cameraActive: true });
  h.advance(20);
  await h.triggerRoundHaptic('correct', { cameraActive: true });
  assert.equal(h.calls.length, 2);
  h.advance(219);
  assert.equal(h.calls.length, 2);
  h.advance(1);
  assert.deepEqual((h.calls[2].value as ReturnType<typeof androidHapticPattern>).timings, [0, 100]);
  h.advance(1000);
  assert.equal(h.calls.length, 3);
});

for (const replacement of ['times-up', 'get-ready', 'initial-countdown', 'cancel'] as const) {
  test(`${replacement} clears a deferred tick without leaving a vibration in the next round`, async () => {
    const h = harness('android');
    await h.triggerRoundHaptic('correct', { cameraActive: false });
    await h.triggerRoundHaptic('final-countdown', { cameraActive: false });
    if (replacement === 'cancel') h.cancelRoundHaptics();
    else await h.triggerRoundHaptic(replacement, { cameraActive: false, countdownValue: 3 });
    const count = h.calls.length;
    h.advance(3000);
    assert.equal(h.calls.length, count);
  });
}

test('amplitude-capable motors retain their short impact patterns', () => {
  assert.deepEqual(androidHapticPattern('pass', undefined, true), { timings: [0, 43], amplitudes: [0, 150] });
  assert.deepEqual(androidHapticPattern('initial-countdown', 1, true).timings, [0, 20, 60, 20, 60, 20]);
});

test('native failure never speculatively dispatches a second vibration', async () => {
  const h = harness('android', 'failed');
  await h.triggerRoundHaptic('correct', { cameraActive: true });
  assert.deepEqual(h.calls.map(c => c.api), ['waveform', 'failure']);
});

test('iOS retains exactly one original native call per cue with and without recording', async () => {
  const h = harness('ios');
  const expected = [];
  for (const cameraActive of [false, true]) {
    for (const { cue, count } of cases) {
      await h.triggerRoundHaptic(cue, { cameraActive, countdownValue: count });
      expected.push({ api: 'ios', value: [cue, count ?? null] });
    }
  }
  assert.deepEqual(h.calls, expected);
});
