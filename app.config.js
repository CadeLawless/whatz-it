module.exports = ({ config }) => {
  const appVariant = process.env.APP_VARIANT;
  const isPreview = appVariant === 'preview';
  const isStaging = appVariant === 'staging';
  const usesTestBranding = isPreview || isStaging;

  return {
    ...config,
    plugins: [...(config.plugins ?? []), 'expo-mail-composer'],
    name: isPreview
      ? 'WHATZ IT? Preview'
      : isStaging
        ? 'WHATZ IT? Staging'
        : config.name,
    scheme: usesTestBranding ? 'whatzit-staging' : config.scheme,
    ios: {
      ...config.ios,
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
