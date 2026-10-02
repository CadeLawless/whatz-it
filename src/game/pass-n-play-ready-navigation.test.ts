import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';

import * as readyTimeline from './pass-n-play-ready';
import * as theme from '../theme';

const require = createRequire(import.meta.url);
type TestElement = { props: { children: TestElement[]; onPress: () => void } };

// Exercise the real X handler with a navigation stack, without native rendering.
function mountReady(hasPreviousDeck: boolean, prepare = () => Promise.resolve(true), recordVideo = false) {
  const stack = hasPreviousDeck ? ['/', '/deck/animals', '/ready'] : ['/ready'];
  const events: string[] = [];
  let timeline = readyTimeline.initialPassNPlayReadyState;
  let refIndex = 0;
  const refs: { current: unknown }[] = [];
  const effects: (() => void | (() => void))[] = [];
  let now = 1000;
  const timers = new Map<number, { callback: () => void; at: number }>();
  let timerId = 0;
  let timerOptions: { onExpire: () => void; onSecond: (value: number) => void };
  const { code } = require('@babel/core').transformFileSync(
    resolve('src/components/pass-n-play-ready-screen.tsx'), {
      configFile: false, babelrc: false,
      presets: [['babel-preset-expo', { worklets: false }]],
    },
  );
  const exports: { PassNPlayReadyScreen?: () => ReactElement } = {};
  const noop = () => {};
  runInNewContext(code, {
    exports,
    Date: { now: () => now },
    setTimeout: (callback: () => void, delay: number) => {
      timers.set(++timerId, { callback, at: now + delay });
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    require(name: string) {
      if (name === 'react') return {
        ...require('react'), useCallback: (callback: unknown) => callback,
        useEffect: (effect: () => void | (() => void)) => effects.push(effect),
        useRef: (current: unknown) => refs[refIndex++] ?? (refs[refIndex - 1] = { current }),
        useState: (initial: unknown) => [initial, noop],
        useReducer: () => [timeline, (action: readyTimeline.PassNPlayReadyAction) => {
          timeline = readyTimeline.passNPlayReadyReducer(timeline, action);
        }],
      };
      if (name === 'expo-router') return {
        useFocusEffect: noop, useIsFocused: () => true,
        useRouter: () => ({
          canGoBack: () => stack.length > 1,
          back: () => { stack.pop(); events.push('back'); },
          replace: (href: string | { params: { deckId: string } }) => {
            stack[stack.length - 1] = typeof href === 'string' ? href : `/deck/${href.params.deckId}`;
            events.push('replace');
          },
        }),
      };
      if (name === 'react-native') return {
        AppState: { currentState: 'active' }, BackHandler: {},
        ScrollView: 'scroll', Text: 'text', View: 'view',
        StyleSheet: { create: (styles: unknown) => styles },
      };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'safe' };
      if (name === 'expo-status-bar') return { StatusBar: 'status' };
      if (name.endsWith('/close-button')) return { CloseButton: 'close' };
      if (name.endsWith('/recording-indicator')) return { RecordingIndicator: 'recording-indicator' };
      if (name.endsWith('/pass-n-play-ready')) return readyTimeline;
      if (name.endsWith('/round-context')) return {
        useRound: () => ({
          round: { status: 'ready', deckId: 'animals', durationSeconds: 60 },
          roundDeck: { title: 'Animals' }, resetRound: () => { events.push('reset'); },
          prepareRecording: async () => recordVideo ? 'ready' : 'unavailable',
          startRecording: async () => { events.push('recording'); return true; },
          cancelRecording: async () => {}, recordOverlayEvent: noop,
          pauseRecording: async () => {}, resumeRecording: async () => false,
        }),
      };
      if (name.endsWith('/use-round-timer')) return {
        useRoundTimer: (options: typeof timerOptions) => { timerOptions = options; return 3; },
      };
      if (name.endsWith('/theme')) return theme;
      if (name.endsWith('/round-haptics')) return { triggerRoundHaptic: noop };
      if (name.endsWith('/round-sound-provider')) return {
        useRoundSounds: () => ({
          play: (cue: string, canPlay: () => boolean) => { if (canPlay()) events.push(cue); },
          prepareForRound: prepare, stopAll: noop, stopIntro: noop,
        }),
      };
      return require(name);
    },
  });
  assert.ok(exports.PassNPlayReadyScreen);
  const render = () => {
    refIndex = 0;
    effects.length = 0;
    return exports.PassNPlayReadyScreen!() as unknown as TestElement;
  };
  const screen = render();
  const panel = screen.props.children[1];
  const close = panel.props.children[0].props.children[0];
  return {
    stack, events, effects, render, phase: () => timeline.phase,
    expireCountdown: () => timerOptions.onExpire(),
    countdownCue: (value: number) => timerOptions.onSecond(value),
    advance: (ms: number) => {
      now += ms;
      for (const [id, timer] of timers) {
        if (timer.at <= now) { timers.delete(id); timer.callback(); }
      }
    },
    cancel: close.props.onPress as () => void,
  };
}

it('cancelling ready returns to the original deck so one back reaches decks', async () => {
  const { stack, events, cancel } = mountReady(true);
  cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['reset', 'back']);
  assert.deepEqual(stack, ['/', '/deck/animals']);
  stack.pop(); // One Back to Decks tap.
  assert.deepEqual(stack, ['/']);
  cancel(); // A second X event cannot add another navigation action.
  assert.deepEqual(events, ['reset', 'back']);
});

it('cancelling a directly opened ready route falls back to deck details', async () => {
  const { stack, events, cancel } = mountReady(false);
  cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(stack, ['/deck/animals']);
  assert.deepEqual(events, ['reset', 'replace']);
});

it('starts the chime and reaches game even before the navigation focus effect loads', async () => {
  const ready = mountReady(true); // useFocusEffect remains unloaded in this harness.
  ready.effects[0]();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready.phase(), 'intro');
  assert.deepEqual(ready.events, ['get-ready']);
  ready.render();
  ready.effects[2](); // Schedule the intro deadline.
  ready.advance(readyTimeline.PASS_N_PLAY_INTRO_MS);
  assert.equal(ready.phase(), 'countdown');
  ready.render();
  for (const value of [3, 2, 1]) ready.countdownCue(value);
  ready.advance(3000);
  ready.expireCountdown();
  ready.render();
  ready.effects[3](); // Navigate after the countdown completes.
  assert.equal(ready.stack.at(-1), '/game');
  assert.deepEqual(ready.events, ['get-ready', 'count-3', 'count-2', 'count-1', 'round-start', 'replace']);
});

it('continues after the audio grace period and ignores preparation after cancellation', async () => {
  const ready = mountReady(true, () => new Promise<boolean>(() => {}));
  ready.effects[0]();
  ready.advance(4000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready.phase(), 'intro');
  const cancelled = mountReady(true);
  cancelled.effects[0]();
  cancelled.cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(cancelled.phase(), 'cancelled');
  assert.deepEqual(cancelled.events, ['reset', 'back']);
});

it('starts optional video before the ready chime', async () => {
  const ready = mountReady(true, () => Promise.resolve(true), true);
  ready.effects[0]();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(ready.phase(), 'intro');
  assert.deepEqual(ready.events, ['recording', 'get-ready']);
});
