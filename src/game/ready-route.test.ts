import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';
import type { ReactElement } from 'react';

import type { GameMode } from './game-types';

const require = createRequire(import.meta.url);

it('keeps Pass n\' Play ready mounted while cancellation resets the round', () => {
  const { code } = require('@babel/core').transformFileSync(resolve('src/app/ready.tsx'), {
    configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
  });
  let roundMode: GameMode = 'pass-n-play';
  let mountedMode: GameMode | undefined;
  const ClassicReadyScreen = () => null;
  const PassNPlayReadyScreen = () => null;
  const exports: { default?: () => ReactElement } = {};
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === 'react') return {
        ...require('react'),
        // Preserve the route's state across renders of this mounted instance.
        useState(initial: GameMode) {
          mountedMode ??= initial;
          return [mountedMode, () => {}];
        },
      };
      if (name.endsWith('/round-context')) return { useRound: () => ({ round: { mode: roundMode } }) };
      if (name.endsWith('/classic-ready-screen')) return { __esModule: true, default: ClassicReadyScreen };
      if (name.endsWith('/pass-n-play-ready-screen')) return { PassNPlayReadyScreen };
      return require(name);
    },
  });
  assert.ok(exports.default);
  assert.equal(exports.default().type, PassNPlayReadyScreen);
  roundMode = 'classic'; // RESET runs before deck navigation completes.
  assert.equal(exports.default().type, PassNPlayReadyScreen);
  mountedMode = undefined; // A newly mounted Classic round still chooses Classic.
  assert.equal(exports.default().type, ClassicReadyScreen);
});
