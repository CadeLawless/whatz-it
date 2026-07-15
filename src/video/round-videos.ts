import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'whatz-it:round-videos:v1';
const MAX_STORED_VIDEOS = 10;
const VIDEO_DIRECTORY_NAME = 'round-videos';

export type RoundVideo = {
  id: string;
  uri: string;
  audioUri?: string;
  exportUri?: string;
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
      const exportUri = video.exportUri && new File(video.exportUri).exists ? video.exportUri : undefined;
      return {
        ...video,
        audioUri,
        exportUri,
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
  await Asset.create(saveUri);
}

async function prepareRoundVideoExportOnce(video: RoundVideo): Promise<RoundVideo> {
  if (Platform.OS === 'web' || !video.events?.length) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }
  const { Directory, File, Paths } = await import('expo-file-system');
  if (video.exportUri && new File(video.exportUri).exists) {
    return updateStoredVideo({ ...video, exportStatus: 'ready' });
  }

  await updateStoredVideo({ ...video, exportUri: undefined, exportStatus: 'preparing' });
  let temporaryExportUri: string | undefined;
  try {
    const { exportOverlayVideo } = await import('whatz-it-video-export');
    temporaryExportUri = await exportOverlayVideo(
      video.uri,
      video.audioUri ?? null,
      video.events,
    );
    const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
    videoDirectory.create({ idempotent: true, intermediates: true });
    const destination = new File(videoDirectory, `${video.id}-export.mp4`);
    if (destination.exists) destination.delete();
    await new File(temporaryExportUri).copy(destination);
    return updateStoredVideo({
      ...video,
      exportUri: destination.uri,
      exportStatus: 'ready',
    });
  } catch {
    return updateStoredVideo({ ...video, exportUri: undefined, exportStatus: 'failed' });
  } finally {
    if (temporaryExportUri) {
      const temporaryFile = new File(temporaryExportUri);
      if (temporaryFile.exists) temporaryFile.delete();
    }
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
