module.exports = ({ config }) => {
  const isPreview = process.env.APP_VARIANT === 'preview';

  return {
    ...config,
    name: isPreview ? 'WHATZ IT? Staging' : config.name,
    scheme: isPreview ? 'whatzit-staging' : config.scheme,
    ios: {
      ...config.ios,
      bundleIdentifier: isPreview
        ? 'com.cadelawless.whatzit.staging'
        : config.ios?.bundleIdentifier,
    },
    android: {
      ...config.android,
      package: isPreview
        ? 'com.cadelawless.whatzit.staging'
        : config.android?.package,
    },
  };
};
