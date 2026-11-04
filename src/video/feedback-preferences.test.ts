import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/storage/feedback-preferences.ts'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});
function preferences(initial: string | null = null) {
  let stored = initial;
  let failWrite = false;
  let reads = 0;
  const fresh = () => {
    const exports = {} as typeof import('../storage/feedback-preferences');
    runInNewContext(code, { exports, require: (name: string) => name === '@react-native-async-storage/async-storage' ? {
      getItem: async () => { reads += 1; return stored; },
      setItem: async (_key: string, value: string) => {
        if (failWrite) { failWrite = false; throw new Error('storage unavailable'); }
        stored = value;
      },
    } : require(name) });
    return exports;
  };
  return { ...fresh(), fresh, reads: () => reads, failNextWrite: () => { failWrite = true; } };
}

it('keeps sound and haptics enabled by default, including malformed saved values', async () => {
  for (const value of [null, 'broken', '{}', '{"sound":"off","haptics":null}']) {
    const prefs = await preferences(value).loadFeedbackPreferences();
    assert.equal(prefs.sound, true);
    assert.equal(prefs.haptics, true);
  }
});

it('restores independent settings on a fresh app instance and caches hot-path reads', async () => {
  const prefs = preferences();
  await prefs.saveFeedbackPreferences({ sound: false, haptics: true });
  const restarted = prefs.fresh();
  await restarted.loadFeedbackPreferences();
  assert.equal(restarted.getFeedbackPreferences().sound, false);
  assert.equal(restarted.getFeedbackPreferences().haptics, true);
  const reads = prefs.reads();
  for (let index = 0; index < 100; index += 1) restarted.getFeedbackPreferences();
  await restarted.loadFeedbackPreferences();
  assert.equal(prefs.reads(), reads);
});

it('publishes only persisted changes, preserves the previous state on failure, and recovers', async () => {
  const prefs = preferences();
  await prefs.loadFeedbackPreferences();
  let changes = 0;
  const unsubscribe = prefs.subscribeToFeedbackPreferences(() => { changes += 1; });
  prefs.failNextWrite();
  await assert.rejects(prefs.saveFeedbackPreferences({ sound: false, haptics: false }));
  assert.equal(changes, 0);
  assert.equal(prefs.getFeedbackPreferences().sound, true);
  await prefs.saveFeedbackPreferences({ sound: true, haptics: false });
  assert.equal(changes, 1);
  assert.equal(prefs.getFeedbackPreferences().haptics, false);
  unsubscribe();
  await prefs.saveFeedbackPreferences({ sound: false, haptics: true });
  assert.equal(changes, 1);
});

it('saves rapid choices in order and lets a pending read see the final choice', async () => {
  const prefs = preferences();
  const first = prefs.saveFeedbackPreferences({ sound: false, haptics: true });
  const last = prefs.saveFeedbackPreferences({ sound: true, haptics: false });
  const loaded = prefs.loadFeedbackPreferences();
  await Promise.all([first, last]);
  assert.equal((await loaded).haptics, false);
  assert.equal(prefs.getFeedbackPreferences().sound, true);
});
