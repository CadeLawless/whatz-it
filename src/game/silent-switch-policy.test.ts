import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSuppressLiveRoundSound } from '../video/silent-switch-policy';

test('suppresses live iOS cues only when supported monitoring reports silent mode', () => {
  assert.equal(
    shouldSuppressLiveRoundSound({
      platform: 'ios',
      monitoringSupported: true,
      silentSwitchOn: true,
    }),
    true,
  );
  assert.equal(
    shouldSuppressLiveRoundSound({
      platform: 'ios',
      monitoringSupported: true,
      silentSwitchOn: false,
    }),
    false,
  );
});

test('does not suppress cues on Android or legacy iOS builds', () => {
  assert.equal(
    shouldSuppressLiveRoundSound({
      platform: 'android',
      monitoringSupported: true,
      silentSwitchOn: true,
    }),
    false,
  );
  assert.equal(
    shouldSuppressLiveRoundSound({
      platform: 'ios',
      monitoringSupported: false,
      silentSwitchOn: true,
    }),
    false,
  );
});
