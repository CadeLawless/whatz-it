import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createElement, type ReactNode } from 'react';

import type { CardOutcome, RoundStatus } from './game-types';
import * as theme from '../theme';

const require = createRequire(import.meta.url);
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (node: ReactNode) => string;
};
const nativeView = ({ children }: { children: ReactNode }) => createElement('div', null, children);
let swipeEnabled = false;
let finishSwipe: (event: { translationX: number; velocityX: number }, success: boolean) => void;

// Render the real presentation with native primitives substituted for server
// rendering. This checks secret content in the tree, not native layout.
function loadComponent(path: string) {
  const { code } = require('@babel/core').transformFileSync(resolve(path), {
    configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
  });
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    global: { Error },
    require(name: string) {
      if (name === 'react-native') return {
        View: nativeView, ScrollView: nativeView, Text: nativeView, Pressable: nativeView,
        StyleSheet: { create: (styles: unknown) => styles },
      };
      if (name.endsWith('/theme')) return theme;
      if (name === 'expo-symbols') return { SymbolView: nativeView };
      if (name === 'react-native-gesture-handler') return {
        GestureDetector: nativeView,
        Gesture: { Pan: () => {
          const gesture = {
            enabled: (enabled: boolean) => { swipeEnabled = enabled; return gesture; },
            maxPointers: () => gesture,
            activeOffsetX: () => gesture, failOffsetY: () => gesture,
            onEnd: (callback: typeof finishSwipe) => { finishSwipe = callback; return gesture; },
          };
          return gesture;
        } },
      };
      if (name === 'react-native-worklets') return { scheduleOnRN: (callback: () => void) => callback() };
      if (name.endsWith('/recording-indicator')) return {
        RecordingIndicator: () => createElement('span', null, 'REC'),
      };
      if (name.endsWith('/close-button')) return loadComponent('src/components/close-button.tsx');
      if (name.endsWith('/portrait-times-up-panel')) {
        return loadComponent('src/components/portrait-times-up-panel.tsx');
      }
      if (name.endsWith('/portrait-round-visuals')) {
        return loadComponent('src/components/portrait-round-visuals.tsx');
      }
      return require(name);
    },
  });
  return exports;
}

const { PassNPlayRoundPanel } = loadComponent('src/components/pass-n-play-round-panel.tsx') as
  typeof import('../components/pass-n-play-round-panel');

function render(status: RoundStatus, outcome?: CardOutcome, onPass = () => {}) {
  const noop = () => {};
  return renderToStaticMarkup(createElement(PassNPlayRoundPanel, {
    status, outcome, deckTitle: 'Animals', clock: '0:49',
    answer: { text: 'Secret flamingo', byline: 'Secret byline' },
    onPass, onCorrect: noop, onReveal: noop, onClose: noop,
    onResume: noop, onFinish: noop,
  }));
}

describe('Pass n\' Play answer visibility', () => {
  it('passes on a deliberate left swipe, while rejecting short, right, and canceled gestures', () => {
    let passes = 0;
    render('playing', undefined, () => { passes += 1; });
    assert.equal(swipeEnabled, true);
    finishSwipe({ translationX: 100, velocityX: 800 }, true);
    finishSwipe({ translationX: -10, velocityX: -800 }, true);
    finishSwipe({ translationX: -100, velocityX: -800 }, false);
    assert.equal(passes, 0);
    finishSwipe({ translationX: -90, velocityX: -100 }, true);
    finishSwipe({ translationX: -30, velocityX: -800 }, true);
    assert.equal(passes, 2);
    for (const status of ['handoff', 'paused', 'feedback', 'ready', 'finished'] as const) {
      render(status);
      assert.equal(swipeEnabled, false);
    }
  });
  it('renders the answer and byline only in active play', () => {
    assert.match(render('playing'), /Secret flamingo/);
    assert.match(render('playing'), /Secret byline/);
    for (const status of ['handoff', 'paused', 'feedback', 'ready', 'finished'] as const) {
      const markup = render(status);
      assert.doesNotMatch(markup, /Secret flamingo|Secret byline/);
    }
  });

  it('gives the recipient a reveal action during handoff', () => {
    const markup = render('handoff');
    assert.match(markup, /Pass the phone/);
    assert.match(markup, /Show my card/);
    assert.doesNotMatch(markup, /Timer paused|CORRECT/);
    assert.doesNotMatch(markup, />PASS<|>Resume</);
  });

  it('offers explicit resume and end actions while paused', () => {
    const markup = render('paused');
    assert.match(markup, /Resume/);
    assert.match(markup, /End round/);
    assert.doesNotMatch(markup, /Show my card/);
  });

  it('keeps the controls without explanatory instructions', () => {
    assert.match(render('playing'), />CORRECT</);
    assert.match(render('playing'), />PASS</);
    for (const status of ['playing', 'handoff', 'paused', 'feedback', 'ready'] as const) {
      assert.doesNotMatch(render(status), /Guessed it\?|Next player:|Hold the phone|Same player|Your first card/);
    }
  });

  it('shows feedback without the deck title, clock, or answer', () => {
    for (const outcome of ['correct', 'passed'] as const) {
      const markup = render('feedback', outcome);
      assert.match(markup, outcome === 'correct' ? /CORRECT!/ : /PASS/);
      assert.doesNotMatch(markup, /Animals|0:49|Secret|Show my card|Timer paused|Pause|Got it!/);
    }
  });
});
