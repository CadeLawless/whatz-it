import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { RoundSoundPlayback } from './round-sound-playback';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/video/round-sounds.ts'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});

function harness(nativeReady: boolean) {
  const calls: string[] = [];
  const exported = {} as typeof import('./round-sounds');
  runInNewContext(code, {
    exports: exported,
    require(name: string) {
      if (name.endsWith('.wav')) return name;
      switch (name) {
        case 'expo-asset': return { Asset: { fromModule: (source: string) => ({
          downloadAsync: async () => ({ localUri: `file://${source}` }),
        }) } };
        case 'react-native': return { Platform: { OS: 'android' } };
        case './round-sound-playback': return { RoundSoundPlayback };
        case 'whatz-it-video-export': return {
          supportsAndroidRoundSounds: () => true,
          prepareAndroidRoundSounds: async () => nativeReady,
          playAndroidRoundSound: (sound: string) => { calls.push(sound); return true; },
        };
        default:
          if (name.endsWith('android-gameplay-trace')) return { traceAndroidGameplay() {} };
          if (name.endsWith('video-diagnostics')) return { logVideoDiagnostic() {}, warnVideoDiagnostic() {} };
          return require(name);
      }
    },
  });
  return { ...exported, calls };
}

test('preloaded Android answers replay immediately without a seek, pause, or native UI getter', async () => {
  const h = harness(true);
  assert.equal(await h.prepareAndroidRoundSoundBank(), true);
  const player = { volume: 1, pause() { assert.fail('unexpected pause'); },
    seekTo() { assert.fail('unexpected seek'); }, play() { assert.fail('unexpected Expo playback'); } };
  const first = h.playRoundSound(player, 'pass');
  assert.deepEqual(h.calls, ['pass'], 'native sound dispatch happens before awaiting the returned promise');
  assert.equal(await first, true);
  assert.equal(await h.playRoundSound(player, 'pass'), true);
  assert.equal(await h.playRoundSound(player, 'flip', () => false), false);
  assert.deepEqual(h.calls, ['pass', 'pass']);
});

test('failed Android preparation retains cancellable Expo playback as a fallback', async () => {
  const h = harness(false);
  assert.equal(await h.prepareAndroidRoundSoundBank(), false);
  let plays = 0;
  const player = { volume: 1, pause() {}, async seekTo() {}, play() { plays++; } };
  assert.equal(await h.playRoundSound(player, 'correct'), true);
  assert.equal(plays, 1);
  assert.deepEqual(h.calls, []);
});
