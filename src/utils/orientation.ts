import * as ScreenOrientation from 'expo-screen-orientation';

const ORIENTATION_SETTLE_MS = 140;

function waitForLayout() {
  return new Promise<void>((resolve) => setTimeout(resolve, ORIENTATION_SETTLE_MS));
}

export async function lockLandscapeOrientation() {
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT).catch(
    () => undefined,
  );
  await waitForLayout();
}

export async function lockPortraitOrientation() {
  await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(
    () => undefined,
  );
  await waitForLayout();
}
