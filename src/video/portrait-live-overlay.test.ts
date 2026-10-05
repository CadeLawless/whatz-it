import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(
  resolve('modules/whatz-it-video-export/src/index.ts'), {
    configFile: false, babelrc: false,
    presets: [['babel-preset-expo', { worklets: false }]],
  },
);

function supportsPortrait(native: Record<string, unknown>) {
  const exports: { supportsPortraitLiveOverlay?: () => boolean } = {};
  runInNewContext(code, {
    exports,
    require(name: string) {
      if (name === 'expo-modules-core') return { requireNativeModule: () => native };
      return require(name);
    },
  });
  return exports.supportsPortraitLiveOverlay!();
}

it('keeps older builds on the portrait recorder fallback', () => {
  assert.equal(supportsPortrait({ overlayExportVersion: 25, muxLiveOverlayVideo() {} }), false);
  assert.equal(supportsPortrait({ portraitLiveOverlayVersion: 1 }), false);
  assert.equal(supportsPortrait({
    portraitLiveOverlayVersion: 1, overlayExportVersion: 24, muxLiveOverlayVideo() {},
  }), false);
});

it('enables portrait live recording only with compatible native writers and muxing', () => {
  assert.equal(supportsPortrait({
    portraitLiveOverlayVersion: 1, overlayExportVersion: 25, muxLiveOverlayVideo() {},
  }), true);
  // Android does not use the iOS export version but must expose both capabilities.
  assert.equal(supportsPortrait({ portraitLiveOverlayVersion: 1, muxLiveOverlayVideo() {} }), true);
});
