import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

const STORAGE_KEY = 'whatz-it:round-videos:v1';
const MAX_STORED_VIDEOS = 10;
const VIDEO_DIRECTORY_NAME = 'round-videos';
const COMPLETED_EXPORT_PATTERN = /^(\d+-[a-z0-9]+)-export\.mp4$/i;

export type RoundVideo = {
  id: string;
  uri: string;
  audioUri?: string;
  exportUri?: string;
  exportIncludesOverlays?: boolean;
  exportStatus?: 'preparing' | 'ready' | 'failed';
  deckId: string;
  createdAt: number;
  events?: RoundVideoEvent[];
};

export type RoundVideoEvent = {
  atMs: number;
  kind: 'countdown' | 'card' | 'correct' | 'passed' | 'times-up';
  text: string;
  byline?: string;
  timerEndsAtMs?: number;
};

type StoredRoundVideo = Omit<RoundVideo, 'uri' | 'audioUri' | 'exportUri'> & {
  uri: string;
  audioUri?: string;
  exportUri?: string;
};

function readExtension(uri: string) {
  const match = uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1] ?? 'mp4';
}

async function readStoredMetadata(): Promise<StoredRoundVideo[]> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as StoredRoundVideo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type RoundVideoLibraryListener = (videos: RoundVideo[]) => void;

const roundVideoLibraryListeners = new Set<RoundVideoLibraryListener>();

export function subscribeToRoundVideoLibrary(listener: RoundVideoLibraryListener) {
  roundVideoLibraryListeners.add(listener);
  return () => roundVideoLibraryListeners.delete(listener);
}

function notifyRoundVideoLibrary(videos: RoundVideo[]) {
  roundVideoLibraryListeners.forEach((listener) => {
    try {
      listener(videos);
    } catch {
      // A screen listener must never interrupt video persistence.
    }
  });
}

async function writeStoredMetadata(videos: RoundVideo[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(videos.map(toStoredRoundVideo)));
  notifyRoundVideoLibrary(videos);
}

const activeExports = new Map<string, Promise<RoundVideo>>();

export async function loadRoundVideos() {
  if (Platform.OS === 'web') return [];
  const { File, storedVideos, videoDirectory, videos } = await readHydratedMetadata();
  const available = videos
    .filter((video) => new File(video.uri).exists)
    .map((video) => {
      const audioUri = video.audioUri && new File(video.audioUri).exists ? video.audioUri : undefined;
      let exportUri = video.exportUri && new File(video.exportUri).exists ? video.exportUri : undefined;
      const hasLegacyIosOverlayExport =
        Platform.OS === 'ios' &&
        !!exportUri &&
        !!video.events?.length &&
        video.exportIncludesOverlays === undefined;
      if (hasLegacyIosOverlayExport && exportUri) {
        new File(exportUri).delete();
        exportUri = undefined;
      }
      return {
        ...video,
        audioUri,
        exportUri,
        exportIncludesOverlays: exportUri ? video.exportIncludesOverlays : undefined,
        exportStatus: exportUri
          ? ('ready' as const)
          : video.events?.length
            ? video.exportStatus === 'failed'
              ? ('failed' as const)
              : ('preparing' as const)
            : ('ready' as const),
      };
    });
  const uniqueAvailable = deduplicateRoundVideosById(available);
  const recovered = recoverCompletedExports(videoDirectory, uniqueAvailable, File);
  const next = [...uniqueAvailable, ...recovered]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_STORED_VIDEOS);
  if (JSON.stringify(next.map(toStoredRoundVideo)) !== JSON.stringify(storedVideos)) {
    await writeStoredMetadata(next);
  }
  return next;
}

export async function storeRoundVideo(
  temporaryUri: string,
  temporaryAudioUri: string | undefined,
  deckId: string,
  events: RoundVideoEvent[] = [],
  diagnosticId?: string,
) {
  const persistenceStartedAt = Date.now();
  if (Platform.OS === 'web') throw new Error('Round recording is only available on a device.');
  const fileSystemImportStartedAt = Date.now();
  const { Directory, File, Paths } = await import('expo-file-system');
  logVideoDiagnostic('round video file system loaded for persistence', {
    diagnosticId,
    elapsedMs: Date.now() - fileSystemImportStartedAt,
  });
  const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
  videoDirectory.create({ idempotent: true, intermediates: true });
  const createdAt = Date.now();
  const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
  const destination = new File(videoDirectory, `${id}.${readExtension(temporaryUri)}`);
  const sourceVideo = new File(temporaryUri);
  const sourceVideoSize = sourceVideo.size;
  const videoMoveStartedAt = Date.now();
  await sourceVideo.move(destination);
  logVideoDiagnostic('round source video moved to persistent storage', {
    diagnosticId,
    elapsedMs: Date.now() - videoMoveStartedAt,
    sourceSize: sourceVideoSize,
    destinationSize: destination.size,
  });

  let audioUri: string | undefined;
  if (temporaryAudioUri) {
    const audioDestination = new File(
      videoDirectory,
      `${id}-audio.${readExtension(temporaryAudioUri)}`,
    );
    const sourceAudio = new File(temporaryAudioUri);
    const sourceAudioSize = sourceAudio.size;
    const audioMoveStartedAt = Date.now();
    await sourceAudio.move(audioDestination);
    logVideoDiagnostic('round audio moved to persistent storage', {
      diagnosticId,
      elapsedMs: Date.now() - audioMoveStartedAt,
      sourceSize: sourceAudioSize,
      destinationSize: audioDestination.size,
    });
    audioUri = audioDestination.uri;
  }

  logVideoDiagnostic('round files persisted', {
    audioDestinationExists: audioUri ? new File(audioUri).exists : false,
    audioDestinationSize: audioUri ? new File(audioUri).size : 0,
    audioUri,
    diagnosticId,
    sourceAudioExistsAfterMove: temporaryAudioUri ? new File(temporaryAudioUri).exists : false,
    sourceAudioUri: temporaryAudioUri,
    videoDestinationExists: destination.exists,
    videoDestinationSize: destination.size,
    sourceVideoExistsAfterMove: new File(temporaryUri).exists,
    videoUri: destination.uri,
    totalElapsedMs: Date.now() - persistenceStartedAt,
  });

  const video: RoundVideo = {
    id,
    uri: destination.uri,
    audioUri,
    exportStatus: events.length ? 'preparing' : 'ready',
    deckId,
    createdAt,
    events,
  };
  const libraryLoadStartedAt = Date.now();
  const previous = await loadRoundVideos();
  logVideoDiagnostic('round video library loaded during persistence', {
    diagnosticId,
    elapsedMs: Date.now() - libraryLoadStartedAt,
    previousVideoCount: previous.length,
  });
  const next = [video, ...previous].slice(0, MAX_STORED_VIDEOS);
  const removed = previous.filter((item) => !next.some((kept) => kept.id === item.id));
  removed.forEach((item) => deleteVideoFiles(item, File));
  const metadataWriteStartedAt = Date.now();
  await writeStoredMetadata(next);
  logVideoDiagnostic('round video metadata persisted', {
    diagnosticId,
    elapsedMs: Date.now() - metadataWriteStartedAt,
    totalElapsedMs: Date.now() - persistenceStartedAt,
    videoCount: next.length,
    videoId: video.id,
  });
  return video;
}

export async function deleteRoundVideo(id: string) {
  if (Platform.OS === 'web') return [];
  const { File, videos } = await readHydratedMetadata();
  const removed = videos.find((video) => video.id === id);
  if (removed) deleteVideoFiles(removed, File);
  const next = videos.filter((video) => video.id !== id);
  await writeStoredMetadata(next);
  return next;
}

export function isRoundVideoReadyToSave(video: RoundVideo) {
  return video.events?.length ? video.exportStatus === 'ready' && !!video.exportUri : true;
}

export function prepareRoundVideoExport(video: RoundVideo) {
  const existing = activeExports.get(video.id);
  if (existing) return existing;
  const preparing = prepareRoundVideoExportOnce(video).finally(() => {
    activeExports.delete(video.id);
  });
  activeExports.set(video.id, preparing);
  return preparing;
}

export async function prepareRoundVideoExports(videos: RoundVideo[]) {
  const prepared: RoundVideo[] = [];
  for (const video of videos) {
    prepared.push(isRoundVideoReadyToSave(video) ? video : await prepareRoundVideoExport(video));
  }
  return prepared;
}

export async function saveRoundVideoToDevice(video: RoundVideo) {
  if (Platform.OS === 'web') throw new Error('Saving videos is only available on a device.');
  const { Asset, requestPermissionsAsync } = await import('expo-media-library');
  const permission = await requestPermissionsAsync(true, ['video']);
  if (!permission.granted) throw new Error('Media library permission was not granted.');
  const saveUri = video.events?.length ? video.exportUri : video.uri;
  if (!saveUri) throw new Error('This video is still being prepared.');
  const { File } = await import('expo-file-system');
  const saveFile = new File(saveUri);
  const nativeAudioValidated = await usesReliableNativeAudioValidation();
  const saveAudioTrackCount = nativeAudioValidated
    ? null
    : await inspectVideoAudioTrackCount(saveUri);
  logVideoDiagnostic('media library save started', {
    audioUri: video.audioUri,
    exportIncludesOverlays: video.exportIncludesOverlays,
    exportUri: video.exportUri,
    saveFileExists: saveFile.exists,
    saveFileSize: saveFile.size,
    saveAudioTrackCount,
    nativeAudioValidated,
    saveUri,
    sourceVideoUri: video.uri,
  });
  if (video.audioUri && saveAudioTrackCount === 0 && !nativeAudioValidated) {
    throw new Error(
      'The exported video has no audio track, so it was not saved. Please send the [RoundVideo] terminal logs so this can be diagnosed.',
    );
  }
  if (video.audioUri && saveAudioTrackCount === 0 && nativeAudioValidated) {
    warnVideoDiagnostic(
      'Expo Video reported no audio tracks after native validation succeeded',
      'Continuing because exporter version 3 validated the finished MP4 with AVFoundation.',
      { saveUri },
    );
  }
  await Asset.create(saveUri);
  logVideoDiagnostic('media library save completed', { saveUri });
}

async function prepareRoundVideoExportOnce(video: RoundVideo): Promise<RoundVideo> {
  const exportStartedAt = Date.now();
  if (Platform.OS === 'web' || !video.events?.length) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  if (video.exportUri && new File(video.exportUri).exists) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }

  const preparingMetadataStartedAt = Date.now();
  await updateStoredVideo({
    ...video,
    exportUri: undefined,
    exportIncludesOverlays: undefined,
    exportStatus: 'preparing',
  });
  logVideoDiagnostic('native export preparing state persisted', {
    elapsedMs: Date.now() - preparingMetadataStartedAt,
    videoId: video.id,
  });
  let temporaryExportUri: string | undefined;
  try {
    const {
      exportOverlayVideo,
      getIosVideoExportVersion,
      supportsFixedIosOverlayExport,
      supportsReliableIosAudioExport,
    } =
      await import('whatz-it-video-export');
    // Existing iOS development builds contain an overlay animation that leaves every
    // prior card visible. Export clean video plus audio until the corrected native
    // exporter arrives in the eventual production build.
    const exportEvents =
      Platform.OS === 'ios' && !supportsFixedIosOverlayExport() ? [] : video.events;
    const audioFile = video.audioUri ? new File(video.audioUri) : null;
    const sourceVideoFile = new File(video.uri);
    const iosVideoExportVersion = Platform.OS === 'ios' ? getIosVideoExportVersion() : null;
    const nativeAudioValidated = Platform.OS === 'ios' && supportsReliableIosAudioExport();
    logVideoDiagnostic('native export started', {
      audioFileExists: audioFile?.exists ?? false,
      audioFileSize: audioFile?.size ?? 0,
      audioUri: video.audioUri,
      exportEventCount: exportEvents.length,
      iosVideoExportVersion,
      nativeAudioValidated,
      sourceEventCount: video.events.length,
      sourceVideoExists: sourceVideoFile.exists,
      sourceVideoSize: sourceVideoFile.size,
      sourceVideoUri: video.uri,
      supportsFixedIosOverlays: supportsFixedIosOverlayExport(),
      supportsReliableIosAudio: supportsReliableIosAudioExport(),
    });
    if (
      Platform.OS === 'ios' &&
      video.audioUri &&
      !supportsReliableIosAudioExport()
    ) {
      throw new Error(
        'This installed app build does not contain the reliable audio exporter. Install the updated build, then retry this export.',
      );
    }
    const brandingStartedAt = Date.now();
    const branding = await loadExportBrandingUris();
    logVideoDiagnostic('native export branding resolved', {
      elapsedMs: Date.now() - brandingStartedAt,
      hasHeadshot: !!branding?.headshotUri,
      hasWordmark: !!branding?.wordmarkUri,
      videoId: video.id,
    });
    const nativeExportStartedAt = Date.now();
    temporaryExportUri = await exportOverlayVideo(
      video.uri,
      video.audioUri ?? null,
      exportEvents,
      branding?.headshotUri ?? null,
      branding?.wordmarkUri ?? null,
    );
    logVideoDiagnostic('native overlay export promise resolved', {
      elapsedMs: Date.now() - nativeExportStartedAt,
      temporaryExportUri,
      videoId: video.id,
    });
    const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
    videoDirectory.create({ idempotent: true, intermediates: true });
    const destination = new File(videoDirectory, `${video.id}-export.mp4`);
    if (destination.exists) destination.delete();
    const temporaryExport = new File(temporaryExportUri);
    const exportMoveStartedAt = Date.now();
    await temporaryExport.move(destination);
    logVideoDiagnostic('native export moved to persistent storage', {
      destinationSize: destination.size,
      elapsedMs: Date.now() - exportMoveStartedAt,
      videoId: video.id,
    });
    const audioInspectionStartedAt = Date.now();
    const exportedAudioTrackCount = nativeAudioValidated
      ? null
      : await inspectVideoAudioTrackCount(destination.uri);
    logVideoDiagnostic('native export completed', {
      destinationExists: destination.exists,
      destinationSize: destination.size,
      destinationUri: destination.uri,
      exportedAudioTrackCount,
      audioInspectionElapsedMs: Date.now() - audioInspectionStartedAt,
      temporaryExportUri,
      totalElapsedMs: Date.now() - exportStartedAt,
      videoId: video.id,
    });
    if (video.audioUri && exportedAudioTrackCount === 0 && !nativeAudioValidated) {
      throw new Error('The native exporter returned a video with no audio track.');
    }
    if (video.audioUri && exportedAudioTrackCount === 0 && nativeAudioValidated) {
      warnVideoDiagnostic(
        'Expo Video reported no audio tracks after native export validation succeeded',
        'Accepting the export so its actual embedded audio can be played and saved.',
        { destinationUri: destination.uri },
      );
    }
    return updateStoredVideo({
      ...video,
      exportUri: destination.uri,
      exportIncludesOverlays: exportEvents.length > 0,
      exportStatus: 'ready',
    });
  } catch (error) {
    warnVideoDiagnostic('native export failed', error, {
      audioUri: video.audioUri,
      sourceVideoUri: video.uri,
      temporaryExportUri,
      totalElapsedMs: Date.now() - exportStartedAt,
      videoId: video.id,
    });
    return updateStoredVideo({
      ...video,
      exportUri: undefined,
      exportIncludesOverlays: undefined,
      exportStatus: 'failed',
    });
  } finally {
    if (temporaryExportUri) {
      const temporaryFile = new File(temporaryExportUri);
      if (temporaryFile.exists) temporaryFile.delete();
    }
  }
}

let exportBrandingUrisPromise: ReturnType<typeof resolveExportBrandingUris> | null = null;

function loadExportBrandingUris() {
  exportBrandingUrisPromise ??= resolveExportBrandingUris();
  return exportBrandingUrisPromise;
}

async function resolveExportBrandingUris() {
  try {
    const { Asset } = await import('expo-asset');
    const [headshot, wordmark] = await Asset.loadAsync([
      require('../../assets/images/branding/albert-headshot.png'),
      require('../../assets/images/branding/whatz-it-wordmark.png'),
    ]);
    return {
      headshotUri: headshot.localUri ?? headshot.uri,
      wordmarkUri: wordmark.localUri ?? wordmark.uri,
    };
  } catch (error) {
    warnVideoDiagnostic('export branding assets unavailable', error);
    return null;
  }
}

async function usesReliableNativeAudioValidation() {
  if (Platform.OS !== 'ios') return false;
  const { supportsReliableIosAudioExport } = await import('whatz-it-video-export');
  return supportsReliableIosAudioExport();
}

async function inspectVideoAudioTrackCount(uri: string): Promise<number | null> {
  const { createVideoPlayer } = await import('expo-video');
  const player = createVideoPlayer(uri);

  try {
    return await new Promise<number | null>((resolve) => {
      let settled = false;
      const cleanup: (() => void)[] = [];
      const finish = (audioTrackCount: number | null) => {
        if (settled) return;
        settled = true;
        cleanup.forEach((remove) => remove());
        resolve(audioTrackCount);
      };

      const sourceSubscription = player.addListener(
        'sourceLoad',
        ({ availableAudioTracks, duration, videoSource }) => {
          logVideoDiagnostic('video audio tracks inspected', {
            audioTrackCount: availableAudioTracks.length,
            audioTracks: availableAudioTracks,
            duration,
            uri,
            videoSource,
          });
          finish(availableAudioTracks.length);
        },
      );
      cleanup.push(() => sourceSubscription.remove());

      const statusSubscription = player.addListener('statusChange', ({ error, status }) => {
        if (status !== 'error') return;
        warnVideoDiagnostic('video audio track inspection failed', error?.message ?? status, {
          uri,
        });
        finish(null);
      });
      cleanup.push(() => statusSubscription.remove());

      const timeout = setTimeout(() => {
        warnVideoDiagnostic('video audio track inspection timed out', 'Metadata did not load.', {
          status: player.status,
          uri,
        });
        finish(null);
      }, 5000);
      cleanup.push(() => clearTimeout(timeout));
    });
  } finally {
    player.release();
  }
}

async function updateStoredVideo(video: RoundVideo) {
  const { videos } = await readHydratedMetadata();
  const next = videos.map((item) => (item.id === video.id ? video : item));
  await writeStoredMetadata(next);
  return video;
}

async function readHydratedMetadata() {
  const { Directory, File, Paths } = await import('expo-file-system');
  const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
  videoDirectory.create({ idempotent: true, intermediates: true });
  const storedVideos = await readStoredMetadata();
  const videos = storedVideos.map((video) =>
    hydrateStoredRoundVideo(video, videoDirectory, File),
  );
  return { File, storedVideos, videoDirectory, videos };
}

function hydrateStoredRoundVideo(
  video: StoredRoundVideo,
  videoDirectory: import('expo-file-system').Directory,
  FileType: typeof import('expo-file-system').File,
): RoundVideo {
  return {
    ...video,
    uri: resolveManagedFileUri(video.uri, videoDirectory, FileType),
    audioUri: video.audioUri
      ? resolveManagedFileUri(video.audioUri, videoDirectory, FileType)
      : undefined,
    exportUri: video.exportUri
      ? resolveManagedFileUri(video.exportUri, videoDirectory, FileType)
      : undefined,
  };
}

function toStoredRoundVideo(video: RoundVideo): StoredRoundVideo {
  return {
    ...video,
    uri: getManagedFileName(video.uri),
    audioUri: video.audioUri ? getManagedFileName(video.audioUri) : undefined,
    exportUri: video.exportUri ? getManagedFileName(video.exportUri) : undefined,
  };
}

function resolveManagedFileUri(
  storedUri: string,
  videoDirectory: import('expo-file-system').Directory,
  FileType: typeof import('expo-file-system').File,
) {
  return new FileType(videoDirectory, getManagedFileName(storedUri)).uri;
}

function getManagedFileName(uri: string) {
  const path = uri.split(/[?#]/, 1)[0].replace(/\\/g, '/');
  const fileName = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}

function recoverCompletedExports(
  videoDirectory: import('expo-file-system').Directory,
  videos: RoundVideo[],
  FileType: typeof import('expo-file-system').File,
) {
  const knownFiles = new Set(
    videos.flatMap((video) => [video.uri, video.audioUri, video.exportUri].filter(Boolean)),
  );
  const knownVideoIds = new Set(videos.map((video) => video.id.toLowerCase()));
  const skippedExistingVideoIds: string[] = [];
  const recovered = videoDirectory
    .list()
    .filter((entry): entry is import('expo-file-system').File => entry instanceof FileType)
    .flatMap((file) => {
      const match = file.name.match(COMPLETED_EXPORT_PATTERN);
      if (!match || knownFiles.has(file.uri)) return [];
      const recoveredId = match[1];
      const normalizedRecoveredId = recoveredId.toLowerCase();
      if (knownVideoIds.has(normalizedRecoveredId)) {
        skippedExistingVideoIds.push(recoveredId);
        return [];
      }
      knownVideoIds.add(normalizedRecoveredId);
      const createdAt = Number(recoveredId.split('-', 1)[0]);
      return [
        {
          id: recoveredId,
          uri: file.uri,
          exportStatus: 'ready' as const,
          deckId: 'recovered',
          createdAt: Number.isFinite(createdAt) ? createdAt : file.creationTime ?? Date.now(),
        },
      ];
    });
  if (skippedExistingVideoIds.length > 0) {
    logVideoDiagnostic('completed export recovery skipped duplicate video ids', {
      skippedCount: skippedExistingVideoIds.length,
      skippedVideoIds: skippedExistingVideoIds,
    });
  }
  if (recovered.length > 0) {
    logVideoDiagnostic('completed round videos recovered from device storage', {
      recoveredCount: recovered.length,
      recoveredFiles: recovered.map((video) => getManagedFileName(video.uri)),
    });
  }
  return recovered;
}

function deduplicateRoundVideosById(videos: RoundVideo[]) {
  const videosById = new Map<string, RoundVideo>();
  const duplicateVideoIds: string[] = [];
  for (const video of videos) {
    const normalizedId = video.id.toLowerCase();
    const existing = videosById.get(normalizedId);
    if (!existing) {
      videosById.set(normalizedId, video);
      continue;
    }
    duplicateVideoIds.push(video.id);
    if (existing.deckId === 'recovered' && video.deckId !== 'recovered') {
      videosById.set(normalizedId, video);
    }
  }
  if (duplicateVideoIds.length > 0) {
    logVideoDiagnostic('duplicate round video metadata repaired', {
      duplicateCount: duplicateVideoIds.length,
      duplicateVideoIds,
    });
  }
  return [...videosById.values()];
}

function deleteVideoFiles(
  video: RoundVideo,
  FileType: typeof import('expo-file-system').File,
) {
  [video.uri, video.audioUri, video.exportUri].forEach((uri) => {
    if (!uri) return;
    const file = new FileType(uri);
    if (file.exists) file.delete();
  });
}
