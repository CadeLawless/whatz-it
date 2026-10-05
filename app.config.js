module.exports = ({ config }) => {
  const appVariant = process.env.APP_VARIANT;
  const isPreview = appVariant === 'preview';
  const isStaging = appVariant === 'staging';
  const usesTestBranding = isPreview || isStaging;
  // Phase 0 is deliberately excluded from production, including incoming activities.
  const sharePlayPrototypeEnabled =
    ['development', 'preview', 'staging'].includes(appVariant) &&
    process.env.EXPO_PUBLIC_SHAREPLAY_DISABLED !== 'true';

  return {
    ...config,
    extra: {
      ...config.extra,
      sharePlayPrototypeEnabled,
      sharePlayEnvironment: `${isStaging ? 'staging' : 'main'}:${process.env.EXPO_PUBLIC_CATALOG_ENVIRONMENT ?? 'production'}`,
    },
    plugins: [...(config.plugins ?? []), 'expo-mail-composer'],
    name: isPreview
      ? 'WHATZ IT? Preview'
      : isStaging
        ? 'WHATZ IT? Staging'
        : config.name,
    scheme: usesTestBranding ? 'whatzit-staging' : config.scheme,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        WhatzItSharePlayPrototypeEnabled: sharePlayPrototypeEnabled,
      },
      entitlements: {
        ...config.ios?.entitlements,
        ...(sharePlayPrototypeEnabled ? { 'com.apple.developer.group-session': true } : {}),
      },
      // App Store Connect products belong to the production app identity.
      // Purchase-capable previews must use it; the staging identity remains
      // available for side-by-side, non-IAP testing.
      bundleIdentifier: isStaging
        ? 'com.cadelawless.whatzit.staging'
        : config.ios?.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: isStaging
        ? 'com.cadelawless.whatzit.staging'
        : config.android?.package,
    },
  };
};
