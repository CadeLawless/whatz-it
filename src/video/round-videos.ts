import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const STORAGE_KEY = 'whatz-it:round-videos:v1';
const MAX_STORED_VIDEOS = 10;
const VIDEO_DIRECTORY_NAME = 'round-videos';

export type RoundVideo = {
  id: string;
  uri: string;
  deckId: string;
  createdAt: number;
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

export async function loadRoundVideos() {
  if (Platform.OS === 'web') return [];
  const { File } = await import('expo-file-system');
  const videos = await readStoredMetadata();
  const available = videos.filter((video) => new File(video.uri).exists);
  if (available.length !== videos.length) await writeStoredMetadata(available);
  return available.sort((a, b) => b.createdAt - a.createdAt);
}

export async function storeRoundVideo(temporaryUri: string, deckId: string) {
  if (Platform.OS === 'web') throw new Error('Round recording is only available on a device.');
  const { Directory, File, Paths } = await import('expo-file-system');
  const videoDirectory = new Directory(Paths.document, VIDEO_DIRECTORY_NAME);
  videoDirectory.create({ idempotent: true, intermediates: true });
  const createdAt = Date.now();
  const id = `${createdAt}-${Math.random().toString(36).slice(2, 8)}`;
  const destination = new File(videoDirectory, `${id}.${readExtension(temporaryUri)}`);
  await new File(temporaryUri).copy(destination);

  const video: RoundVideo = { id, uri: destination.uri, deckId, createdAt };
  const previous = await loadRoundVideos();
  const next = [video, ...previous].slice(0, MAX_STORED_VIDEOS);
  const removed = previous.filter((item) => !next.some((kept) => kept.id === item.id));
  removed.forEach((item) => {
    const file = new File(item.uri);
    if (file.exists) file.delete();
  });
  await writeStoredMetadata(next);
  return video;
}

export async function deleteRoundVideo(id: string) {
  if (Platform.OS === 'web') return [];
  const { File } = await import('expo-file-system');
  const videos = await readStoredMetadata();
  const removed = videos.find((video) => video.id === id);
  if (removed) {
    const file = new File(removed.uri);
    if (file.exists) file.delete();
  }
  const next = videos.filter((video) => video.id !== id);
  await writeStoredMetadata(next);
  return next;
}

export async function saveRoundVideoToDevice(uri: string) {
  if (Platform.OS === 'web') throw new Error('Saving videos is only available on a device.');
  const { Asset, requestPermissionsAsync } = await import('expo-media-library');
  const permission = await requestPermissionsAsync(true, ['video']);
  if (!permission.granted) throw new Error('Media library permission was not granted.');
  await Asset.create(uri);
}
