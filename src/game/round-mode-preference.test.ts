import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import * as gameMode from './game-mode';
import * as roundDuration from './round-duration';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/storage/preferences.ts'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});

function loadPreferences(storage: {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
}) {
  const exports = {} as typeof import('../storage/preferences');
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === '@react-native-async-storage/async-storage') return storage;
      if (name.endsWith('/game-mode')) return gameMode;
      if (name.endsWith('/round-duration')) return roundDuration;
      return require(name);
    },
  });
  return exports;
}

describe('round mode preference', () => {
  it('restores a saved mode and defaults missing or malformed values to Classic', async () => {
    for (const [value, expected] of [[null, 'classic'], ['broken', 'classic'], ['pass-n-play', 'pass-n-play']] as const) {
      const preferences = loadPreferences({ getItem: async () => value, setItem: async () => {} });
      assert.equal(await preferences.loadRoundMode(), expected);
    }
  });

  it('defaults to Classic when preference storage is unavailable', async () => {
    const preferences = loadPreferences({
      getItem: async () => { throw new Error('storage unavailable'); }, setItem: async () => {},
    });
    assert.equal(await preferences.loadRoundMode(), 'classic');
  });

  it('writes rapid selections in order and waits for them before loading', async () => {
    let stored: string | null = null;
    const writes: string[] = [];
    let releaseFirst = () => {};
    let firstStarted = () => {};
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    const preferences = loadPreferences({
      getItem: async () => stored,
      setItem: async (_key, value) => {
        writes.push(value);
        if (writes.length === 1) { firstStarted(); await blocked; }
        stored = value;
      },
    });
    const first = preferences.saveRoundMode('classic');
    const second = preferences.saveRoundMode('pass-n-play');
    const load = preferences.loadRoundMode();
    await started;
    assert.deepEqual(writes, ['classic']);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(writes, ['classic', 'pass-n-play']);
    assert.equal(await load, 'pass-n-play');
  });

  it('allows another selection after a failed write', async () => {
    let attempts = 0;
    let stored: string | null = null;
    const preferences = loadPreferences({
      getItem: async () => stored,
      setItem: async (_key, value) => {
        if (++attempts === 1) throw new Error('write unavailable');
        stored = value;
      },
    });
    await assert.rejects(preferences.saveRoundMode('classic'));
    await preferences.saveRoundMode('pass-n-play');
    assert.equal(await preferences.loadRoundMode(), 'pass-n-play');
  });
});
