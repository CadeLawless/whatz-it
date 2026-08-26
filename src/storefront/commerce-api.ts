import { fetch } from 'expo/fetch';

import {
  configuredCatalogManifestUrl,
  configuredDevPreviewEnabled,
} from '@/catalog/catalog-feature';

import { applePurchaseRequiresRestore } from './apple-purchase-verification';
import type { InstallationIdentity } from './installation-identity';

export type CommerceEntitlements = {
  installationId: string;
  products: { productId: string; kind: 'deck' | 'bundle'; targetId: string }[];
  deckIds: string[];
  verifiedAt: string;
};

export type SandboxResetResult = {
  installationId: string;
  revokedEntitlementCount: number;
  resetAt: string;
};

export class CommerceApiError extends Error {
  public constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CommerceApiError';
  }
}

export function configuredCommerceApiBaseUrl(
  explicit = process.env.EXPO_PUBLIC_COMMERCE_API_BASE_URL,
  developmentPreview = configuredDevPreviewEnabled(),
) {
  if (developmentPreview) return null;
  if (explicit) return validApiBase(explicit);
  const manifest = configuredCatalogManifestUrl();
  if (!manifest) return null;
  const url = new URL(manifest);
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

export async function registerInstallation(
  baseUrl: string,
  identity: InstallationIdentity,
) {
  await apiRequest(baseUrl, '/api/v1/installations/apple', {
    method: 'POST',
    body: JSON.stringify(identity),
  });
}

export function fetchEntitlements(baseUrl: string, identity: InstallationIdentity) {
  return authenticatedRequest(baseUrl, '/api/v1/entitlements', identity);
}

export async function verifyApplePurchase(
  baseUrl: string,
  identity: InstallationIdentity,
  signedTransaction: string,
  reason: 'purchase' | 'restore',
) {
  try {
    return await verifyAppleTransaction(baseUrl, identity, signedTransaction, reason);
  } catch (error) {
    if (reason !== 'purchase' || !applePurchaseRequiresRestore(error)) throw error;
    return verifyAppleTransaction(baseUrl, identity, signedTransaction, 'restore');
  }
}

export function resetSandboxPurchases(
  baseUrl: string,
  identity: InstallationIdentity,
) {
  return authenticatedRequest<SandboxResetResult>(
    baseUrl,
    '/api/v1/testing/reset-purchases',
    identity,
    { method: 'POST' },
  );
}

function authenticatedRequest<T = CommerceEntitlements>(
  baseUrl: string,
  path: string,
  identity: InstallationIdentity,
  init: RequestInit = {},
) {
  return apiRequest<T>(baseUrl, path, {
    ...init,
    headers: {
      ...objectHeaders(init.headers),
      Authorization: `Bearer ${identity.credential}`,
      'X-Whatzit-Installation-Id': identity.installationId,
    },
  });
}

function verifyAppleTransaction(
  baseUrl: string,
  identity: InstallationIdentity,
  signedTransaction: string,
  reason: 'purchase' | 'restore',
) {
  return authenticatedRequest(
    baseUrl,
    reason === 'purchase'
      ? '/api/v1/purchases/apple/verify'
      : '/api/v1/purchases/apple/restore',
    identity,
    { method: 'POST', body: JSON.stringify({ signedTransaction }) },
  );
}

async function apiRequest<T = unknown>(baseUrl: string, path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...objectHeaders(init.headers) },
    });
  } catch {
    throw new CommerceApiError('network_error', 0, 'The purchase server could not be reached.');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' ? (body as { error?: { code?: unknown; message?: unknown } }).error : undefined;
    throw new CommerceApiError(
      typeof error?.code === 'string' ? error.code : 'request_failed',
      response.status,
      typeof error?.message === 'string' ? error.message : 'The purchase request failed.',
    );
  }
  const data = body && typeof body === 'object' ? (body as { data?: unknown }).data : undefined;
  return data as T;
}

function validApiBase(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    url.pathname = url.pathname.replace(/\/$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function objectHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}
