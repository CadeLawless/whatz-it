import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requestModePermissions } from './round-setup';

describe('mode-specific setup permissions', () => {
  it('requests optional video for Pass n\' Play without requesting motion', async () => {
    let requestedVideo = false;
    await requestModePermissions('pass-n-play',
      async () => { assert.fail('motion requested'); },
      async () => { requestedVideo = true; });
    assert.equal(requestedVideo, true);
  });

  it('retains Classic permission ordering', async () => {
    const calls: string[] = [];
    await requestModePermissions('classic',
      async () => { calls.push('motion'); }, async () => { calls.push('video'); });
    assert.deepEqual(calls, ['motion', 'video']);
  });

  it('keeps Classic playable if optional video permission requests fail', async () => {
    await assert.doesNotReject(requestModePermissions('classic',
      async () => {}, async () => { throw new Error('video unavailable'); }));
  });
});
