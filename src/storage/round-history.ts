import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RoundResultSnapshot } from '@/game/round-result-snapshot';
import { pruneRoundVideos, readRoundVideoMetadata, type RoundVideo } from '@/video/round-videos';

export type SavedRound = {
  id: string;
  deckId: string;
  createdAt: number;
  resultSnapshot?: RoundResultSnapshot;
  videoId?: string;
  sharePlay?: boolean;
  deleted?: boolean;
};

const STORAGE_KEY = 'whatz-it:round-history:v1';
export const MAX_SAVED_ROUNDS = 10;
type RoundIdentity = Pick<SavedRound, 'id' | 'createdAt'>;
type StoredHistory = { version: 2; rounds: SavedRound[]; prunedThrough?: RoundIdentity };
let queue: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

export function subscribeToRoundHistory(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => undefined).then(operation);
  queue = result;
  return result;
}

async function read(): Promise<StoredHistory & { legacy?: boolean }> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  const parsed: unknown = stored ? JSON.parse(stored) : [];
  const state = Array.isArray(parsed) ? { rounds: parsed, legacy: true } : parsed as StoredHistory;
  if (!state || !Array.isArray(state.rounds)) throw new Error('Saved round history could not be read.');
  const rounds = state.rounds.filter((value): value is SavedRound =>
    value && typeof value.id === 'string' && typeof value.deckId === 'string' && Number.isFinite(value.createdAt));
  if (Array.isArray(parsed)) {
    for (const video of await readRoundVideoMetadata()) {
      if (!rounds.some((round) => round.id === (video.roundId ?? video.id) || round.videoId === video.id)) {
        rounds.push({ id: video.roundId ?? video.id, deckId: video.deckId, createdAt: video.createdAt,
          videoId: video.id, resultSnapshot: video.resultSnapshot });
      }
    }
  }
  return { ...state, version: 2, rounds };
}

function newestFirst(a: RoundIdentity, b: RoundIdentity) {
  return b.createdAt - a.createdAt || b.id.localeCompare(a.id);
}

async function write(state: StoredHistory & { legacy?: boolean }) {
  const sorted = [...state.rounds].sort(newestFirst);
  const removed = sorted.slice(MAX_SAVED_ROUNDS);
  const prunedThrough = [...removed, ...(state.prunedThrough ? [state.prunedThrough] : [])]
    .sort(newestFirst)[0];
  const next: StoredHistory = { version: 2, rounds: sorted.slice(0, MAX_SAVED_ROUNDS),
    ...(prunedThrough ? { prunedThrough: { id: prunedThrough.id, createdAt: prunedThrough.createdAt } } : {}) };
  const stored = JSON.stringify(next);
  const changed = stored !== await AsyncStorage.getItem(STORAGE_KEY);
  if (changed) await AsyncStorage.setItem(STORAGE_KEY, stored);
  // Cleanup also runs on unchanged loads, so interrupted deletions are retried.
  await pruneRoundVideos(next.rounds.filter((round) => !round.deleted));
  if (!changed) return next.rounds;
  for (const listener of listeners) {
    try { listener(); } catch { /* A screen must not interrupt persistence. */ }
  }
  return next.rounds;
}

function canImport(state: StoredHistory, round: RoundIdentity) {
  return !state.prunedThrough || newestFirst(round, state.prunedThrough) < 0;
}

// Migrate existing recordings, then retain the newest ten rounds, with or without video.
export function loadRoundHistory(videos: RoundVideo[] = []): Promise<SavedRound[]> {
  return serialize(async () => {
    const state = await read();
    const { rounds } = state;
    const knownVideoIds = new Set(rounds.map((round) => round.videoId));
    const imported = videos.filter((video) => (state.legacy || !video.roundId) &&
      canImport(state, { id: video.roundId ?? video.id, createdAt: video.createdAt }) && !knownVideoIds.has(video.id) &&
      !rounds.some((round) => round.id === (video.roundId ?? video.id))).map((video): SavedRound => ({
        id: video.roundId ?? video.id, deckId: video.deckId, createdAt: video.createdAt,
        videoId: video.id, resultSnapshot: video.resultSnapshot,
      }));
    const next = [...rounds.map((round) => {
      const video = videos.find((candidate) => candidate.roundId === round.id);
      if (!video || round.videoId === video.id) return round;
      return { ...round, videoId: video.id };
    }), ...imported].sort((a, b) => b.createdAt - a.createdAt);
    const retained = await write({ ...state, rounds: next });
    return retained.filter((round) => !round.deleted && (round.resultSnapshot || videos.some((video) => video.id === round.videoId)));
  });
}

export function saveRoundResult(round: SavedRound & { resultSnapshot: RoundResultSnapshot }) {
  return serialize(async () => {
    const state = await read();
    const { rounds } = state;
    // Repeated finish callbacks and SharePlay view updates must not duplicate a round.
    if (rounds.some((item) => item.id === round.id) || !canImport(state, round)) return write(state);
    return write({ ...state, rounds: [round, ...rounds] });
  });
}

export function attachRoundVideo(roundId: string, videoId: string) {
  return serialize(async () => {
    const state = await read();
    const { rounds } = state;
    // Deleting results while video processing finishes must not restore them.
    if (!rounds.some((round) => round.id === roundId && !round.deleted)) return write(state);
    return write({ ...state, rounds: rounds.map((round) => round.id === roundId ? { ...round, videoId } : round) });
  });
}

export function deleteSavedRound(id: string) {
  return serialize(async () => {
    // Keep only an identity marker so late exports or repeated remote views
    // cannot restore a deleted score and its card-by-card details.
    const state = await read();
    const rounds = await write({ ...state, rounds: state.rounds.map((round) => round.id === id
      ? { id: round.id, deckId: round.deckId, createdAt: round.createdAt, deleted: true } : round) });
    return rounds.filter((round) => !round.deleted);
  });
}
