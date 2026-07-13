import * as ScreenOrientation from 'expo-screen-orientation';

const ORIENTATION_SETTLE_MS = 140;
const ORIENTATION_CHECK_MS = 50;
const ORIENTATION_CHECK_ATTEMPTS = 20;

function waitForLayout() {
  return new Promise<void>((resolve) => setTimeout(resolve, ORIENTATION_SETTLE_MS));
}

export async function lockLandscapeOrientation() {
  const applied = await ScreenOrientation.lockAsync(
    ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT,
  ).then(
    () => true,
    () => false,
  );
  if (!applied) return false;

  for (let attempt = 0; attempt < ORIENTATION_CHECK_ATTEMPTS; attempt += 1) {
    const orientation = await ScreenOrientation.getOrientationAsync().catch(
      () => ScreenOrientation.Orientation.UNKNOWN,
    );
    if (orientation === ScreenOrientation.Orientation.LANDSCAPE_RIGHT) {
      await waitForLayout();
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ORIENTATION_CHECK_MS));
  }

  return false;
}

export async function lockPortraitOrientation() {
  const applied = await ScreenOrientation.lockAsync(
    ScreenOrientation.OrientationLock.PORTRAIT_UP,
  ).then(
    () => true,
    () => false,
  );
  if (!applied) return false;

  for (let attempt = 0; attempt < ORIENTATION_CHECK_ATTEMPTS; attempt += 1) {
    const orientation = await ScreenOrientation.getOrientationAsync().catch(
      () => ScreenOrientation.Orientation.UNKNOWN,
    );
    if (orientation === ScreenOrientation.Orientation.PORTRAIT_UP) {
      await waitForLayout();
      return true;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ORIENTATION_CHECK_MS));
  }

  return false;
}
