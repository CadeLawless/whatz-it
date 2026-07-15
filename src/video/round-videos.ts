import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { logVideoDiagnostic, warnVideoDiagnostic } from '@/video/video-diagnostics';

const STORAGE_KEY = 'whatz-it:round-videos:v1';
const MAX_STORED_VIDEOS = 10;
const VIDEO_DIRECTORY_NAME = 'round-videos';

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
};

function readExtension(uri: string) {
  const match = uri.split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1] ?? 'mp4';
}

async function readStoredMetadata(): Promise<RoundVideo[]> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as RoundVideo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStoredMetadata(videos: RoundVideo[]) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(videos));
}

const activeExports = new Map<string, Promise<RoundVideo>>();

export async function loadRoundVideos() {
  if (Platform.OS === 'web') return [];
  const { File } = await import('expo-file-system');
  const videos = await readStoredMetadata();
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
  if (JSON.stringify(available) !== JSON.stringify(videos)) await writeStoredMetadata(available);
  return available.sort((a, b) => b.createdAt - a.createdAt);
}

export async function storeRoundVideo(
  temporaryUri: string,
  temporaryAudioUri: string | undefined,
  deckId: string,
  events: RoundVideoEvent[] = [],
) {
  if (Platform.OS === 'web') throw new Error('Round recording is only available on a device.');
  const { Directory, File, Paths } = await import('expo-file-system');
  const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
  videoDirectory.create({ idempotent: true, intermediates: true });
  const createdAt = Date.now();
  const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
  const destination = new File(videoDirectory, `${id}.${readExtension(temporaryUri)}`);
  await new File(temporaryUri).copy(destination);

  let audioUri: string | undefined;
  if (temporaryAudioUri) {
    const audioDestination = new File(
      videoDirectory,
      `${id}-audio.${readExtension(temporaryAudioUri)}`,
    );
    await new File(temporaryAudioUri).copy(audioDestination);
    audioUri = audioDestination.uri;
  }

  logVideoDiagnostic('round files persisted', {
    audioDestinationExists: audioUri ? new File(audioUri).exists : false,
    audioDestinationSize: audioUri ? new File(audioUri).size : 0,
    audioUri,
    sourceAudioExists: temporaryAudioUri ? new File(temporaryAudioUri).exists : false,
    sourceAudioSize: temporaryAudioUri ? new File(temporaryAudioUri).size : 0,
    sourceAudioUri: temporaryAudioUri,
    videoDestinationExists: destination.exists,
    videoDestinationSize: destination.size,
    videoUri: destination.uri,
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
  const previous = await loadRoundVideos();
  const next = [video, ...previous].slice(0, MAX_STORED_VIDEOS);
  const removed = previous.filter((item) => !next.some((kept) => kept.id === item.id));
  removed.forEach((item) => deleteVideoFiles(item, File));
  await writeStoredMetadata(next);
  return video;
}

export async function deleteRoundVideo(id: string) {
  if (Platform.OS === 'web') return [];
  const { File } = await import('expo-file-system');
  const videos = await readStoredMetadata();
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
  const saveAudioTrackCount = await inspectVideoAudioTrackCount(saveUri);
  logVideoDiagnostic('media library save started', {
    audioUri: video.audioUri,
    exportIncludesOverlays: video.exportIncludesOverlays,
    exportUri: video.exportUri,
    saveFileExists: saveFile.exists,
    saveFileSize: saveFile.size,
    saveAudioTrackCount,
    saveUri,
    sourceVideoUri: video.uri,
  });
  if (video.audioUri && saveAudioTrackCount === 0) {
    throw new Error(
      'The exported video has no audio track, so it was not saved. Please send the [RoundVideo] terminal logs so this can be diagnosed.',
    );
  }
  await Asset.create(saveUri);
  logVideoDiagnostic('media library save completed', { saveUri });
}

async function prepareRoundVideoExportOnce(video: RoundVideo): Promise<RoundVideo> {
  if (Platform.OS === 'web' || !video.events?.length) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  if (video.exportUri && new File(video.exportUri).exists) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }

  await updateStoredVideo({
    ...video,
    exportUri: undefined,
    exportIncludesOverlays: undefined,
    exportStatus: 'preparing',
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
    logVideoDiagnostic('native export started', {
      audioFileExists: audioFile?.exists ?? false,
      audioFileSize: audioFile?.size ?? 0,
      audioUri: video.audioUri,
      exportEventCount: exportEvents.length,
      iosVideoExportVersion,
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
    temporaryExportUri = await exportOverlayVideo(
      video.uri,
      video.audioUri ?? null,
      exportEvents,
    );
    const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
    videoDirectory.create({ idempotent: true, intermediates: true });
    const destination = new File(videoDirectory, `${video.id}-export.mp4`);
    if (destination.exists) destination.delete();
    await new File(temporaryExportUri).copy(destination);
    const exportedAudioTrackCount = await inspectVideoAudioTrackCount(destination.uri);
    logVideoDiagnostic('native export completed', {
      destinationExists: destination.exists,
      destinationSize: destination.size,
      destinationUri: destination.uri,
      exportedAudioTrackCount,
      temporaryExportUri,
    });
    if (video.audioUri && exportedAudioTrackCount === 0) {
      throw new Error('The native exporter returned a video with no audio track.');
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
  const videos = await readStoredMetadata();
  const next = videos.map((item) => (item.id === video.id ? video : item));
  await writeStoredMetadata(next);
  return video;
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
