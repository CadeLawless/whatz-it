import { Image, type ImageRef } from 'expo-image';

export const HOME_BRANDING_SOURCES = {
  headshot: require('../../assets/images/branding/albert-headshot.png'),
  wordmark: require('../../assets/images/branding/whatz-it-wordmark.png'),
} as const;

export type HomeBranding = {
  headshot: ImageRef;
  wordmark: ImageRef;
};

let loadedBranding: HomeBranding | null = null;
let brandingLoad: Promise<HomeBranding> | null = null;

export function getLoadedHomeBranding() {
  return loadedBranding;
}

export function loadHomeBranding() {
  if (loadedBranding) return Promise.resolve(loadedBranding);
  if (brandingLoad) return brandingLoad;

  brandingLoad = Promise.all([
    Image.loadAsync(HOME_BRANDING_SOURCES.headshot),
    Image.loadAsync(HOME_BRANDING_SOURCES.wordmark),
  ])
    .then(([headshot, wordmark]) => {
      loadedBranding = { headshot, wordmark };
      return loadedBranding;
    })
    .catch((error) => {
      brandingLoad = null;
      throw error;
    });

  return brandingLoad;
}
