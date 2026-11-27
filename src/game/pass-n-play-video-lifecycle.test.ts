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

function mountGame(status: ActiveRoundStatus | 'finished' | 'paused', options: {
  captureIssue?: string | null;
  resumeSucceeds?: boolean;
} = {}) {
  const round: RoundState = {
    ...initialRoundState, mode: 'pass-n-play', status, deckId: 'animals',
    cardOrder: ['one', 'two'], durationSeconds: 60,
    startedAt: 1000, endsAt: 61_000,
    results: [{ cardId: 'one', outcome: 'correct', answeredAt: 3000 }],
    latestOutcome: status === 'feedback' ? 'correct' : null,
    ...(status === 'paused' ? { pausedStatus: 'playing' as const, remainingMs: 48_000 } : {}),
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
      if (name.endsWith('/capture-recovery-overlay')) return { CaptureRecoveryOverlay: 'recovery' };
      if (name.endsWith('/round-context')) return { useRound: () => ({
        round, roundDeck: deck, pauseRound: noop, startRound: noop,
        advanceCard: () => {
          calls.push('advance');
          Object.assign(round, roundReducer(round, { type: 'ADVANCE', now: 4000 }));
        },
        expireRound: (endsAt: number) => {
          Object.assign(round, roundReducer(round, { type: 'EXPIRE', endsAt, now: endsAt }));
        },
        captureIssue: options.captureIssue ?? null,
        pauseRecording: async () => {},
        resumeRecording: async () => options.resumeSucceeds ?? false,
        retryCapture: async () => { calls.push('retry-capture'); return options.resumeSucceeds ?? false; },
        continueWithoutVideo: async () => { calls.push('continue-without-video'); },
        cancelRecording: async () => { calls.push('cancel-recording'); },
        resumeRound: () => calls.push('resume-round'), finishRound: () => calls.push('finish-round'),
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
      }, getRemainingSecondsFromMs: (remainingMs: number | null) => Math.ceil((remainingMs ?? 0) / 1000) };
      if (name.endsWith('/round-duration')) return { formatRoundClock: () => '0:00' };
      if (name.endsWith('/theme')) return theme;
      if (name.endsWith('/round-haptics')) return { triggerRoundHaptic: (kind: string) => haptics.push(kind) };
      if (name.endsWith('/round-sound-provider')) return {
        useRoundSounds: () => ({ play: noop, stopAll: noop }),
      };
      return require(name);
    },
  });
  const output = exports.PassNPlayGameScreen!();
  effects.forEach((effect) => {
    const cleanup = effect();
    if (typeof cleanup === 'function') cleanups.push(cleanup as () => void);
  });
  return { timers, events, calls, round, haptics, output, saved: () => saved,
    timer: () => timerOptions, dispose: () => cleanups.forEach((cleanup) => cleanup()) };
}

function findElement(node: unknown, type: string): { props: Record<string, () => unknown> } | null {
  if (!node || typeof node !== 'object') return null;
  const element = node as { type?: unknown; props?: { children?: unknown } };
  if (element.type === type) return element as { props: Record<string, () => unknown> };
  const children = element.props?.children;
  const values = Array.isArray(children) ? children : [children];
  for (const child of values) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
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

it('freezes a failed-capture round and resumes only after confirmed recovery', async () => {
  const failed = mountGame('paused', { captureIssue: 'resume-failed', resumeSucceeds: false });
  assert.equal(failed.timer().active, false);
  assert.equal(failed.round.currentCardIndex, 0);
  const failedPanel = findElement(failed.output, 'panel');
  failedPanel!.props.onResume();
  await Promise.resolve();
  assert.equal(failed.calls.includes('resume-round'), false);
  assert.ok(findElement(failed.output, 'recovery'));

  const recovered = mountGame('paused', { captureIssue: 'resume-failed', resumeSucceeds: true });
  findElement(recovered.output, 'panel')!.props.onResume();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(recovered.calls.includes('resume-round'), true);
});

it('offers retry, explicit video fallback, and cleanup from capture recovery', async () => {
  const game = mountGame('paused', { captureIssue: 'camera-session-failed' });
  const recovery = findElement(game.output, 'recovery')!;
  recovery.props.onRetry();
  recovery.props.onContinueWithoutVideo();
  recovery.props.onBack();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(game.calls.includes('retry-capture'));
  assert.ok(game.calls.includes('continue-without-video'));
  assert.ok(game.calls.includes('cancel-recording'));
  assert.ok(game.calls.includes('finish-round'));
});
