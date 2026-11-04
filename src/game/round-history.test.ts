import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { RoundResultSnapshot } from './round-result-snapshot';
import type { RoundVideo } from '../video/round-videos';

const require = createRequire(import.meta.url);
const { code } = require('@babel/core').transformFileSync(resolve('src/storage/round-history.ts'), {
  configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
});
const snapshot: RoundResultSnapshot = {
  version: 1, mode: 'pass-n-play', deckId: 'animals', deckTitle: 'Animals', durationSeconds: 60,
  results: [{ cardId: 'one', text: 'Flamingo', outcome: 'correct', answeredAt: 1000 }],
};

function library(initial: unknown = null) {
  let stored: string | null = initial === null ? null : JSON.stringify(initial);
  const cleaned: string[][] = [];
  let failNextWrite = false;
  const exports = {} as typeof import('../storage/round-history');
  runInNewContext(code, { exports, require: (name: string) => {
    if (name.endsWith('/round-videos')) return {
      readRoundVideoMetadata: async () => [],
      pruneRoundVideos: async (rounds: { id: string }[]) => { cleaned.push(Array.from(rounds, (round) => round.id)); },
    };
    if (name !== '@react-native-async-storage/async-storage') return require(name);
    return { getItem: async () => stored, setItem: async (_key: string, value: string) => {
      if (failNextWrite) { failNextWrite = false; throw new Error('storage unavailable'); }
      stored = value;
    } };
  } });
  return { ...exports, cleaned, stored: () => JSON.parse(stored!), failWrite: () => { failNextWrite = true; } };
}
const video = (id: string, roundId?: string): RoundVideo => ({
  id, roundId, deckId: 'animals', uri: `file:///${id}.mp4`, createdAt: 1000, resultSnapshot: snapshot,
});

it('stores only the latest ten results even when none have videos', async () => {
  const history = library();
  await Promise.all(Array.from({ length: 15 }, (_, index) => history.saveRoundResult({
    id: `round-${index}`, deckId: 'animals', createdAt: index, resultSnapshot: snapshot,
  })));
  const rounds = await history.loadRoundHistory();
  assert.equal(rounds.length, 10);
  assert.equal(rounds.at(-1)?.id, 'round-5');
  assert.equal(history.stored().rounds.length, 10);
  assert.equal(history.stored().prunedThrough.id, 'round-4');
  assert.equal(rounds[0].id, 'round-14');
  assert.equal(rounds[0].videoId, undefined);
  assert.equal(rounds[0].resultSnapshot?.results[0].text, 'Flamingo');
});

it('trims existing oversized history on load and requests cleanup for the retained rounds', async () => {
  const history = library(Array.from({ length: 15 }, (_, index) => ({
    id: `round-${index}`, deckId: 'animals', createdAt: index, resultSnapshot: snapshot,
    ...(index % 2 ? { videoId: `video-${index}` } : {}),
  })));
  const rounds = await history.loadRoundHistory();
  assert.equal(rounds.length, 10);
  assert.equal(history.stored().rounds.length, 10);
  assert.deepEqual(history.cleaned.at(-1), Array.from(rounds, (round) => round.id));
  // Repeated old results and late recordings cannot restore an evicted round,
  // even after all retained results have been manually deleted.
  for (const round of rounds) await history.deleteSavedRound(round.id);
  await history.saveRoundResult({ id: 'round-0', deckId: 'animals', createdAt: 0, resultSnapshot: snapshot });
  await history.attachRoundVideo('round-0', 'late');
  assert.equal((await history.loadRoundHistory([video('late', 'round-0')])).length, 0);
  assert.equal(history.stored().rounds.length, 10);
});

it('bounds video migration and does not backfill older videos after deletion', async () => {
  const history = library();
  const videos = Array.from({ length: 15 }, (_, index) => ({ ...video(`video-${index}`), createdAt: index }));
  const rounds = await history.loadRoundHistory(videos);
  assert.equal(rounds.length, 10);
  await history.deleteSavedRound(rounds[0].id);
  const reloaded = await history.loadRoundHistory(videos);
  assert.equal(reloaded.length, 9);
  assert.equal(reloaded.at(-1)?.createdAt, 5);
});

it('imports existing recordings once and retains their scores after videos are removed', async () => {
  const history = library();
  assert.equal((await history.loadRoundHistory([video('old')])).length, 1);
  assert.equal((await history.loadRoundHistory([video('old')])).length, 1);
  const rounds = await history.loadRoundHistory([]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].resultSnapshot?.deckTitle, 'Animals');
});

it('joins a recording to its saved result even if migration runs before video linking', async () => {
  const history = library();
  await history.saveRoundResult({ id: 'round', deckId: 'animals', createdAt: 500, resultSnapshot: snapshot });
  const rounds = await history.loadRoundHistory([video('capture', 'round')]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].id, 'round');
  assert.equal(rounds[0].videoId, 'capture');
  await history.attachRoundVideo('round', 'capture');
  assert.equal((await history.loadRoundHistory([video('capture', 'round')])).length, 1);
});

it('does not duplicate repeated finish or SharePlay result updates', async () => {
  const history = library();
  const round = { id: 'shareplay:session:round', deckId: 'animals', createdAt: 1000, resultSnapshot: snapshot, sharePlay: true };
  await Promise.all([history.saveRoundResult(round), history.saveRoundResult(round)]);
  assert.equal((await history.loadRoundHistory()).length, 1);
});

it('deletes results without a video and ignores a late video-link callback', async () => {
  const history = library();
  await history.saveRoundResult({ id: 'round', deckId: 'animals', createdAt: 1000, resultSnapshot: snapshot });
  await history.deleteSavedRound('round');
  await history.attachRoundVideo('round', 'late-video');
  assert.equal((await history.loadRoundHistory()).length, 0);
  assert.equal((await history.loadRoundHistory([video('late-video', 'round')])).length, 0);
  await history.saveRoundResult({ id: 'round', deckId: 'animals', createdAt: 1000, resultSnapshot: snapshot });
  assert.equal((await history.loadRoundHistory()).length, 0);
});

it('continues saving after a failed write and notifies subscribers only after persistence', async () => {
  const history = library();
  let changes = 0;
  const unsubscribe = history.subscribeToRoundHistory(() => { changes += 1; });
  const round = { id: 'round', deckId: 'animals', createdAt: 1000, resultSnapshot: snapshot };
  history.failWrite();
  await assert.rejects(history.saveRoundResult(round));
  assert.equal(changes, 0);
  await history.saveRoundResult(round);
  assert.equal(changes, 1);
  unsubscribe();
  await history.deleteSavedRound('round');
  assert.equal(changes, 1);
});
