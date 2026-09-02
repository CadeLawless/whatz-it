import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);

test('React Compiler countdown renders track the same committed seconds as audio', (context) => {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const babel = require('@babel/core');
  const { code } = babel.transformFileSync(resolve('src/hooks/use-round-timer.ts'), {
    configFile: false, babelrc: false,
    presets: [['babel-preset-expo', { worklets: false }]],
    caller: { name: 'metro', platform: 'android', supportsReactCompiler: true, isDev: false },
  });

  // Execute the actual compiled hook with deterministic render/effect commits.
  // This catches the original bug: a state update re-rendered the hook, but its
  // return expression was cached solely by the unchanged endsAt prop.
  const slots: unknown[] = [];
  const cleanups: (() => void)[] = [];
  let cursor = 0;
  let dirty = false;
  let effects: (() => void)[] = [];
  let cache: unknown[];
  const react = {
    useState(initial: () => unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial();
      return [slots[index], (value: unknown) => { slots[index] = value; dirty = true; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as unknown[] | undefined;
      if (!previous || deps.some((value, offset) => !Object.is(value, previous[offset]))) {
        slots[index] = deps;
        effects.push(() => {
          cleanups[index]?.();
          cleanups[index] = effect() ?? (() => {});
        });
      }
    },
  };
  const exported: { useRoundTimer?: (options: unknown) => number } = {};
  runInNewContext(code, {
    exports: exported, Date, setTimeout, clearTimeout,
    require: (name: string) => name === 'react' ? react :
      name === 'react/compiler-runtime' ? {
        c: (size: number) => cache ??= Array(size).fill(Symbol.for('react.memo_cache_sentinel')),
      } : require(name),
  });
  const cues: number[] = [];
  let expires = 0;
  let displayed = -1;
  const options = {
    endsAt: 3000, active: true,
    onSecond: (value: number) => {
      assert.equal(displayed, value, 'cue follows the committed visible number');
      cues.push(value);
    },
    onExpire: () => { expires += 1; },
  };
  const render = () => {
    do {
      dirty = false;
      cursor = 0;
      effects = [];
      displayed = exported.useRoundTimer!(options);
      for (const effect of effects) effect();
    } while (dirty);
    return displayed;
  };
  assert.equal(render(), 3);
  context.mock.timers.tick(1000);
  assert.equal(render(), 2);
  context.mock.timers.tick(1000);
  assert.equal(render(), 1);
  context.mock.timers.tick(1000);
  assert.equal(render(), 0);
  assert.deepEqual(cues, [3, 2, 1, 0]);
  assert.equal(expires, 1);
  render();
  assert.equal(expires, 1);
  cleanups.forEach((cleanup) => cleanup());
});
