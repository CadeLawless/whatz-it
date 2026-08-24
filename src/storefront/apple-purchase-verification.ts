export function applePurchaseRequiresRestore(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const failure = error as { code?: unknown; message?: unknown; status?: unknown };
  if (failure.status !== 409) return false;
  if (failure.code === 'purchase_restore_required') return true;

  // Compatibility during the staging API rollout. Remove after every deployed
  // API returns the dedicated purchase_restore_required code.
  return failure.code === 'purchase_rejected'
    && failure.message === 'The Apple transaction belongs to a different app account token.';
}
