import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
function preferences(initial: string | null = null) {
  let stored = initial;
  const exports = {} as typeof import('../storage/video-preferences');
  const { code } = require('@babel/core').transformFileSync(resolve('src/storage/video-preferences.ts'), {
    configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
  });
  runInNewContext(code, { exports, require: (name: string) => name === '@react-native-async-storage/async-storage' ? ({
    getItem: async () => stored, setItem: async (_key: string, value: string) => { stored = value; },
  }) : require(name) });
  return exports;
}

it('preserves the existing capture defaults for new and malformed preferences', async () => {
  for (const stored of [null, 'broken', '{}', '{"classic":"false"}']) {
    const prefs = await preferences(stored).loadVideoPreferences();
    assert.equal(prefs.classic, true);
    assert.equal(prefs['pass-n-play'], true);
    assert.equal(prefs.microphone, true);
  }
});

it('persists independent video modes and microphone audio in write order', async () => {
  const prefs = preferences();
  const first = prefs.saveVideoPreferences({ classic: true, 'pass-n-play': false, microphone: true });
  const second = prefs.saveVideoPreferences({ classic: true, 'pass-n-play': false, microphone: false });
  const loaded = prefs.loadVideoPreferences();
  await Promise.all([first, second]);
  const value = await loaded;
  assert.equal(value.classic, true);
  assert.equal(value['pass-n-play'], false);
  assert.equal(value.microphone, false);
});
