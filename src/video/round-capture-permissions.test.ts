import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
type CameraStatus = 'authorized' | 'denied' | 'not-determined' | 'restricted';

function permissions({
  cameraStatus = 'authorized' as CameraStatus,
  cameraRequest = true,
  microphone = true,
  settingsError = false,
} = {}) {
  let status = cameraStatus;
  let cameraRequests = 0;
  let microphoneRequests = 0;
  let settingsOpens = 0;
  const visionCamera = {
    get cameraPermissionStatus() { return status; },
    microphonePermissionStatus: 'not-determined',
    requestCameraPermission: async () => {
      cameraRequests += 1;
      status = cameraRequest ? 'authorized' : 'denied';
      return cameraRequest;
    },
    requestMicrophonePermission: async () => {
      microphoneRequests += 1;
      return microphone;
    },
  };
  const { code } = require('@babel/core').transformFileSync(
    resolve('src/video/round-capture-permissions.ts'), {
      configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
    },
  );
  const exports = {} as typeof import('./round-capture-permissions');
  runInNewContext(code, { exports, require: (name: string) => {
    if (name === 'react-native-vision-camera') return { VisionCamera: visionCamera };
    if (name === 'react-native') return { Linking: { openSettings: async () => {
      settingsOpens += 1;
      if (settingsError) throw new Error('settings unavailable');
    } } };
    return require(name);
  } });
  return {
    ...exports,
    counts: () => ({ cameraRequests, microphoneRequests, settingsOpens }),
    setCameraStatus: (next: CameraStatus) => { status = next; },
  };
}

it('reports requestable camera permission without prompting during preparation', async () => {
  const capture = permissions({ cameraStatus: 'not-determined' });
  const result = await capture.prepareRoundCameraPermissions();
  assert.equal(result.cameraState, 'requestable');
  assert.deepEqual(capture.counts(), { cameraRequests: 0, microphoneRequests: 0, settingsOpens: 0 });
});

it('requests requestable camera permission and reports grant or denial', async () => {
  const granted = permissions({ cameraStatus: 'not-determined' });
  assert.equal(await granted.recoverRoundCameraPermission(), 'granted');
  assert.equal(granted.counts().cameraRequests, 1);

  const denied = permissions({ cameraStatus: 'not-determined', cameraRequest: false });
  assert.equal(await denied.recoverRoundCameraPermission(), 'denied');
  assert.equal(denied.counts().cameraRequests, 1);
});

it('opens app settings for permanently denied and restricted camera permission', async () => {
  for (const cameraStatus of ['denied', 'restricted'] as const) {
    const capture = permissions({ cameraStatus });
    assert.equal(await capture.recoverRoundCameraPermission(), 'settings-opened');
    assert.deepEqual(capture.counts(), { cameraRequests: 0, microphoneRequests: 0, settingsOpens: 1 });
  }
});

it('surfaces a failure to open app settings', async () => {
  const capture = permissions({ cameraStatus: 'denied', settingsError: true });
  assert.equal(await capture.recoverRoundCameraPermission(), 'settings-error');
});

it('refreshes permission state after returning from settings with or without a grant', async () => {
  const capture = permissions({ cameraStatus: 'denied' });
  assert.equal((await capture.prepareRoundCameraPermissions()).cameraState, 'denied');
  capture.setCameraStatus('authorized');
  assert.equal((await capture.prepareRoundCameraPermissions({ microphone: false })).cameraState, 'authorized');
  capture.setCameraStatus('denied');
  assert.equal((await capture.prepareRoundCameraPermissions()).cameraState, 'denied');
});

it('records silently without requesting microphone access when audio is off', async () => {
  const capture = permissions();
  const result = await capture.prepareRoundCameraPermissions({ microphone: false });
  assert.equal(result.cameraGranted, true);
  assert.equal(result.microphoneGranted, false);
  assert.equal(capture.counts().microphoneRequests, 0);
});

it('keeps video available if microphone permission is denied', async () => {
  const capture = permissions({ microphone: false });
  const result = await capture.prepareRoundCameraPermissions();
  assert.equal(result.cameraGranted, true);
  assert.equal(result.microphoneGranted, false);
});
