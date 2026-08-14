import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const IDENTITY_KEY = 'whatzit.commerce.installation.v1';
const KEYCHAIN_SERVICE = 'com.cadelawless.whatzit.commerce';

export type InstallationIdentity = {
  version: 1;
  installationId: string;
  appAccountToken: string;
  credential: string;
};

let identityPromise: Promise<InstallationIdentity> | null = null;

export function loadOrCreateInstallationIdentity() {
  identityPromise ??= loadOrCreate();
  return identityPromise;
}

async function loadOrCreate(): Promise<InstallationIdentity> {
  const options = {
    keychainService: KEYCHAIN_SERVICE,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
  const stored = await SecureStore.getItemAsync(IDENTITY_KEY, options);
  if (stored) {
    const parsed: unknown = JSON.parse(stored);
    if (isIdentity(parsed)) return parsed;
  }

  const bytes = await Crypto.getRandomBytesAsync(32);
  const identity: InstallationIdentity = {
    version: 1,
    installationId: Crypto.randomUUID(),
    appAccountToken: Crypto.randomUUID(),
    credential: [...bytes]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join(''),
  };
  await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(identity), options);
  return identity;
}

function isIdentity(value: unknown): value is InstallationIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Partial<InstallationIdentity>;
  return (
    identity.version === 1 &&
    isUuid(identity.installationId) &&
    isUuid(identity.appAccountToken) &&
    typeof identity.credential === 'string' &&
    /^[a-f0-9]{64}$/.test(identity.credential)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)
  );
}
