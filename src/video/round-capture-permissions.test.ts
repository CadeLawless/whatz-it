import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
function permissions(camera = true, microphone = true) {
  let cameraRequests = 0;
  let microphoneRequests = 0;
  const { code } = require('@babel/core').transformFileSync(resolve('src/video/round-capture-permissions.ts'), {
    configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
  });
  const exports = {} as typeof import('./round-capture-permissions');
  runInNewContext(code, { exports, require: (name: string) => name === 'react-native-vision-camera' ? ({ VisionCamera: {
    cameraPermissionStatus: 'not-determined', microphonePermissionStatus: 'not-determined',
    requestCameraPermission: async () => { cameraRequests += 1; return camera; },
    requestMicrophonePermission: async () => { microphoneRequests += 1; return microphone; },
  } }) : require(name) });
  return { ...exports, counts: () => [cameraRequests, microphoneRequests] };
}

it('records silently without requesting microphone access when audio is off', async () => {
  const capture = permissions();
  const result = await capture.requestRoundCameraPermissions({ microphone: false });
  assert.equal(result.cameraGranted, true);
  assert.equal(result.microphoneGranted, false);
  assert.deepEqual(capture.counts(), [1, 0]);
});

it('keeps video available if microphone permission is denied', async () => {
  const capture = permissions(true, false);
  const result = await capture.requestRoundCameraPermissions();
  assert.equal(result.cameraGranted, true);
  assert.equal(result.microphoneGranted, false);
});

it('stops before requesting microphone access if camera access is denied', async () => {
  const capture = permissions(false);
  const result = await capture.requestRoundCameraPermissions();
  assert.equal(result.cameraGranted, false);
  assert.deepEqual(capture.counts(), [1, 0]);
});
