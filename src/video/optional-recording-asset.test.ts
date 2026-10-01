import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForOptionalRecordingAsset } from './optional-recording-asset';

test('an unreachable branding download cannot block recording startup', async () => {
  const never = new Promise<string>(() => {});
  assert.equal(await waitForOptionalRecordingAsset(never, 20), null);
});

test('cached branding remains available and a late download can serve the next round', async () => {
  const branding = { headshotUri: 'file:///headshot.png' };
  assert.equal(await waitForOptionalRecordingAsset(Promise.resolve(branding)), branding);
  let finish!: (value: typeof branding) => void;
  const download = new Promise<typeof branding>((resolve) => { finish = resolve; });
  assert.equal(await waitForOptionalRecordingAsset(download, 20), null);
  finish(branding);
  assert.equal(await waitForOptionalRecordingAsset(download), branding);
});
