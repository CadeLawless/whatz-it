import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { successfulRestoreNotice } from './restore-purchases-notice';

describe('restore purchase notices', () => {
  it('distinguishes no Apple purchases from already-restored ownership', () => {
    assert.equal(successfulRestoreNotice({
      status: 'success',
      newlyRestoredProductCount: 0,
      restoredProductCount: 0,
    }).title, 'No purchases found');
    assert.equal(successfulRestoreNotice({
      status: 'success',
      newlyRestoredProductCount: 0,
      restoredProductCount: 1,
    }).title, 'Purchases already restored');
  });

  it('reports newly recovered ownership as restored', () => {
    assert.equal(successfulRestoreNotice({
      status: 'success',
      newlyRestoredProductCount: 1,
      restoredProductCount: 1,
    }).title, 'Purchases restored');
  });
});
