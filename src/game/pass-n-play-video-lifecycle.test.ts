import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

import { initialRoundState, roundReducer } from './game-reducer';
import { captureRoundResultSnapshot } from './round-result-snapshot';
import type { ActiveRoundStatus, RoundState } from './game-types';
import type { RoundVideoEvent } from '../video/round-videos';
import * as theme from '../theme';

const require = createRequire(import.meta.url);

function mountGame(status: ActiveRoundStatus | 'finished') {
  const round: RoundState = {
    ...initialRoundState, mode: 'pass-n-play', status, deckId: 'animals',
    cardOrder: ['one', 'two'], durationSeconds: 60,
    startedAt: 1000, endsAt: 61_000,
    results: [{ cardId: 'one', outcome: 'correct', answeredAt: 3000 }],
    latestOutcome: status === 'feedback' ? 'correct' : null,
  };
  const deck = { id: 'animals', title: 'Animals', order: 1, description: 'Animal cards', version: 1,
    access: 'free' as const, tags: [], cardCount: 2, cardContentVersion: 1,
    installationStatus: 'installed' as const, cards: [
    { id: 'one', text: 'Flamingo' }, { id: 'two', text: 'Hidden next card' },
  ] };
  const effects: (() => unknown)[] = [];
  const timers: (() => void)[] = [];
  const cleanups: (() => void)[] = [];
  let timerOptions: { active: boolean; endsAt: number; onExpire: () => void };
  const events: Omit<RoundVideoEvent, 'atMs'>[] = [];
  const calls: string[] = [];
  const haptics: string[] = [];
  let saved: ReturnType<typeof captureRoundResultSnapshot>;
  const noop = () => {};
  const { code } = require('@babel/core').transformFileSync(
    resolve('src/components/pass-n-play-game-screen.tsx'), {
      configFile: false, babelrc: false,
      presets: [['babel-preset-expo', { worklets: false }]],
    },
  );
  const exports: { PassNPlayGameScreen?: () => unknown } = {};
  runInNewContext(code, {
    exports, setTimeout: (callback: () => void) => { timers.push(callback); return 1; },
    clearTimeout: noop,
    require(name: string) {
      if (name === 'react') return {
        ...require('react'), useCallback: (callback: unknown) => callback,
        useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, noop],
        useEffect: (effect: () => unknown) => effects.push(effect),
        useLayoutEffect: (effect: () => unknown) => effect(),
      };
      if (name === 'expo-router') return {
        useFocusEffect: (effect: () => unknown) => effect(), useIsFocused: () => true,
        useRouter: () => ({ replace: (route: string) => calls.push(route) }),
      };
      if (name === 'expo-keep-awake') return { useKeepAwake: noop };
      if (name === 'expo-status-bar') return { StatusBar: 'status' };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'safe' };
      if (name === 'react-native') return {
        AppState: { currentState: 'active', addEventListener: () => ({ remove: noop }) },
        BackHandler: { addEventListener: () => ({ remove: noop }) },
        Pressable: 'button', Text: 'text', View: 'view',
        StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
      };
      if (name.endsWith('/pass-n-play-round-panel')) return { PassNPlayRoundPanel: 'panel' };
      if (name.endsWith('/round-context')) return { useRound: () => ({
        round, roundDeck: deck, pauseRound: noop, startRound: noop,
        advanceCard: () => {
          calls.push('advance');
          Object.assign(round, roundReducer(round, { type: 'ADVANCE', now: 4000 }));
        },
        expireRound: (endsAt: number) => {
          Object.assign(round, roundReducer(round, { type: 'EXPIRE', endsAt, now: endsAt }));
        },
        pauseRecording: async () => {}, resumeRecording: async () => false,
        recordOverlayEvent: (event: Omit<RoundVideoEvent, 'atMs'>) => events.push({ ...event }),
        stopRecording: async () => {
          saved = captureRoundResultSnapshot(round, deck);
          calls.push('save-video-and-results');
          return null;
        },
      }) };
      if (name.endsWith('/use-round-timer')) return { useRoundTimer: (options: typeof timerOptions) => {
        timerOptions = options;
        return 0;
      } };
      if (name.endsWith('/round-duration')) return { formatRoundClock: () => '0:00' };
      if (name.endsWith('/theme')) return theme;
      if (name.endsWith('/round-haptics')) return { triggerRoundHaptic: (kind: string) => haptics.push(kind) };
      if (name.endsWith('/round-sound-provider')) return {
        useRoundSounds: () => ({ play: noop, stopAll: noop }),
      };
      return require(name);
    },
  });
  exports.PassNPlayGameScreen!();
  effects.forEach((effect) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
  });
  return { timers, events, calls, round, haptics, saved: () => saved,
    timer: () => timerOptions, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

it('finalizes the video with Pass n\' Play results before opening results', () => {
  const game = mountGame('finished');
  assert.deepEqual(game.events, [{ kind: 'times-up', text: "TIME'S UP!" }]);
  assert.deepEqual(game.calls, []); // Keep recording through the Time's Up beat.
  game.timers.at(-1)!();
  assert.deepEqual(game.calls, ['save-video-and-results', '/results']);
  assert.equal(game.saved()?.mode, 'pass-n-play');
  assert.equal(game.saved()?.results[0].text, 'Flamingo');
  game.timers.at(-1)!();
  assert.equal(game.calls.length, 2); // Finalize once.
});

it('records correct feedback without showing the next answer in the video', () => {
  const game = mountGame('feedback');
  assert.deepEqual(game.events, [{ kind: 'correct', text: 'CORRECT!' }]);
  assert.equal(game.calls.length, 0);
  assert.deepEqual(game.haptics, ['correct']);
});

it('completes success feedback only once, without restarting the clock', () => {
  const game = mountGame('feedback');
  const deadline = game.round.endsAt;
  assert.equal(game.timer().active, true);
  game.timers[0]();
  game.timers[0]();
  assert.deepEqual(game.calls, ['advance']);
  assert.equal(game.round.status, 'handoff');
  assert.equal(game.round.endsAt, deadline);
  assert.equal(game.round.currentCardIndex, 0);
});

it('keeps the timer active and the next answer out of the handoff overlay', () => {
  const game = mountGame('handoff');
  assert.deepEqual(game.events, [{ kind: 'countdown', text: 'Pass the phone then tap the screen' }]);
  assert.equal(game.timer().active, true);
  assert.equal(game.timer().endsAt, 61_000);
  game.timer().onExpire();
  assert.equal(game.round.status, 'finished');
  assert.equal(game.round.results.length, 1);
});

it('ignores a pending success callback after expiry or effect cleanup', () => {
  const expired = mountGame('feedback');
  expired.timer().onExpire();
  expired.timers[0]();
  assert.equal(expired.round.status, 'finished');
  assert.deepEqual(expired.calls, []);

  const unmounted = mountGame('feedback');
  unmounted.dispose();
  // Simulate a callback already queued even though clearTimeout ran.
  unmounted.timers[0]();
  assert.deepEqual(unmounted.calls, []);
});
