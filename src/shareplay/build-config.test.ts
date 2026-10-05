import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const configure = require('../../app.config.js');

test('native capability and prototype are limited to explicit test builds', () => {
  const original = { variant: process.env.APP_VARIANT, disabled: process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED };
  const base = { ios: { infoPlist: { Existing: true }, entitlements: { existing: true } }, extra: { eas: { projectId: 'keep' } } };
  try {
    delete process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED;
    for (const variant of ['development', 'preview', 'staging', 'production', undefined]) {
      if (variant) process.env.APP_VARIANT = variant; else delete process.env.APP_VARIANT;
      const result = configure({ config: base });
      const allowed = !!variant && variant !== 'production';
      assert.equal(result.extra.sharePlayPrototypeEnabled, allowed);
      assert.equal(result.ios.infoPlist.WhatzItSharePlayPrototypeEnabled, allowed);
      assert.equal(result.ios.entitlements['com.apple.developer.group-session'], allowed ? true : undefined);
      assert.equal(result.ios.infoPlist.Existing, true);
      assert.equal(result.ios.entitlements.existing, true);
      assert.deepEqual(result.extra.eas, { projectId: 'keep' });
    }
    process.env.APP_VARIANT = 'development';
    process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED = 'true';
    assert.equal(configure({ config: base }).extra.sharePlayPrototypeEnabled, false);
    assert.equal(configure({ config: base }).ios.infoPlist.WhatzItSharePlayPrototypeEnabled, false);
  } finally {
    if (original.variant === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = original.variant;
    if (original.disabled === undefined) delete process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED; else process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED = original.disabled;
  }
});
