/** Optional branding must not strand recording startup on an asset download. */
export async function waitForOptionalRecordingAsset<T>(
  asset: Promise<T>,
  timeoutMs = 1500,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      asset,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
