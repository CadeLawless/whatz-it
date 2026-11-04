import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';

import type { FeedbackPreferences } from '../storage/feedback-preferences';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/video/round-sound-provider.tsx'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});
function mount(sound = true, haptics = true, soundsLoaded = true) {
  let preferences: FeedbackPreferences = { sound, haptics };
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const effects: (() => unknown)[] = [];
  let sharePlay = false;
  const noop = () => {};
  const exports = {} as typeof import('./round-sound-provider');
  runInNewContext(code, { exports, require(name: string) {
    if (name === 'react') return {
      ...require('react'), useCallback: (callback: unknown) => callback,
      useMemo: (callback: () => unknown) => callback(), useRef: (current: unknown) => ({ current }),
      useState: (initial: unknown) => [initial, noop], useEffect: (effect: () => unknown) => effects.push(effect),
      useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
    };
    if (name === 'expo-router') return { usePathname: () => '/game' };
    if (name === 'expo-audio') return {
      useAudioPlayer: () => ({}), useAudioPlayerStatus: () => ({ isLoaded: soundsLoaded }),
      setAudioModeAsync: async () => { calls.push('audio-mode'); },
      setIsAudioActiveAsync: async () => { calls.push('activate-audio'); },
    };
    if (name === 'react-native') return {
      Platform: { OS: 'ios', select: (options: { ios: unknown }) => options.ios },
      AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
    };
    if (name === 'whatz-it-video-export') return { stopAndroidRoundSounds: () => calls.push('stop-native-sounds') };
    if (name.endsWith('/round-haptics')) return { cancelRoundHaptics: () => calls.push('cancel-haptics') };
    if (name.endsWith('/audio-policy')) return { isSharePlayAudioBlocked: () => sharePlay };
    if (name.endsWith('/feedback-preferences')) return {
      getFeedbackPreferences: () => preferences,
      subscribeToFeedbackPreferences: (listener: () => void) => {
        listeners.add(listener); return () => { listeners.delete(listener); };
      },
    };
    if (name.endsWith('/round-sounds')) return {
      getRoundSoundSource: (sound: string) => sound, isAndroidRoundSoundBankReady: () => false,
      prepareAndroidRoundSoundBank: async () => { calls.push('prepare-bank'); return false; },
      stopRoundSoundPlayer: () => calls.push('stop-player'),
      rewindRoundSoundPlayer: async () => true,
      playRoundSound: async (_player: unknown, sound: string, current: () => boolean) => {
        if (!current()) return false;
        calls.push(`play:${sound}`); return true;
      },
    };
    if (name.endsWith('/video-diagnostics')) return { logRoundDiagnostic: noop, warnRoundDiagnostic: noop };
    return require(name);
  } });
  type Controls = ReturnType<typeof import('./round-sound-provider').useRoundSounds>;
  const element = exports.RoundSoundProvider({ children: null }) as ReactElement<{ value: Controls }>;
  return {
    controls: element.props.value, calls,
    runEffects: () => effects.forEach((effect) => effect()),
    setSharePlay: (value: boolean) => { sharePlay = value; },
    setPreferences: (value: FeedbackPreferences) => { preferences = value; listeners.forEach((listener) => listener()); },
  };
}

it('muted local and SharePlay preparation succeeds without waiting for sounds or activating audio', async () => {
  const { controls, calls, setSharePlay } = mount(false, true, false);
  assert.equal(controls.isReady, true);
  assert.equal(controls.loadTimedOut, false);
  assert.equal(await controls.prepareForRound(), true);
  assert.equal(await controls.play('correct'), false);
  setSharePlay(true);
  assert.equal(await controls.prepareForSharePlay(() => true), true);
  assert.equal(await controls.playSharePlay('round-start', () => true), false);
  assert.deepEqual(calls, []);
});

it('muting stops active sounds without canceling haptics', () => {
  const game = mount();
  game.runEffects();
  game.calls.length = 0;
  game.setPreferences({ sound: false, haptics: true });
  assert.ok(game.calls.includes('stop-native-sounds'));
  assert.ok(game.calls.includes('stop-player'));
  assert.ok(!game.calls.includes('cancel-haptics'));
});

it('disabling haptics leaves local and SharePlay sound playback enabled', async () => {
  const { controls, calls, setSharePlay } = mount(true, false);
  assert.equal(await controls.play('correct'), true);
  setSharePlay(true);
  assert.equal(await controls.playSharePlay('pass', () => true), true);
  assert.deepEqual(calls, ['play:correct', 'play:pass']);
});
