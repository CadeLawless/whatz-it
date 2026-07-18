module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        packageImportPath:
          'import com.margelo.nitro.whatzit.liveoverlay.WhatzItLiveOverlayPackage;',
        packageInstance: 'new WhatzItLiveOverlayPackage()',
      },
    },
  },
};
