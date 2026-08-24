import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { applePurchaseRequiresRestore } from './apple-purchase-verification';

describe('Apple purchase verification recovery', () => {
  it('restores a transaction tied to an earlier installation', () => {
    assert.equal(
      applePurchaseRequiresRestore({
        code: 'purchase_restore_required',
        status: 409,
        message: 'This Apple purchase belongs to an earlier installation and must be restored.',
      }),
      true,
    );
  });

  it('supports the previous staging response while the API is being deployed', () => {
    assert.equal(
      applePurchaseRequiresRestore({
        code: 'purchase_rejected',
        status: 409,
        message: 'The Apple transaction belongs to a different app account token.',
      }),
      true,
    );
  });

  it('does not restore unrelated purchase rejections', () => {
    assert.equal(
      applePurchaseRequiresRestore({
        code: 'purchase_rejected',
        status: 409,
        message: 'The Apple transaction is for a different app or product type.',
      }),
      false,
    );
  });
});
