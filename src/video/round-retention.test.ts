import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { it } from 'node:test';
import { runInNewContext } from 'node:vm';

import type { RoundResultSnapshot } from '../game/round-result-snapshot';
import type { RoundVideo } from './round-videos';

const require = createRequire(import.meta.url);
const snapshot: RoundResultSnapshot = { version: 1, mode: 'classic', deckId: 'animals',
  deckTitle: 'Animals', durationSeconds: 60, results: [] };

function storage() {
  const directory = 'file:///documents/round-videos/';
  const files = new Set<string>();
  const values = new Map<string, string>();
  class File {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = name === undefined ? String(parent) : `${typeof parent === 'string' ? parent : parent.uri}${name}`;
    }
    get name() { return this.uri.split('/').at(-1)!; }
    get exists() { return files.has(this.uri); }
    get size() { return 100; }
    delete() { files.delete(this.uri); }
    move(destination: File) { files.delete(this.uri); files.add(destination.uri); this.uri = destination.uri; }
  }
  class Directory {
    uri = directory;
    create() {}
    list() { return [...files].filter((uri) => uri.startsWith(directory)).map((uri) => new File(uri)); }
  }
  const videos: RoundVideo[] = Array.from({ length: 15 }, (_, index) => ({
    id: `${index}-video`, roundId: `round-${index}`, deckId: 'animals', createdAt: index,
    uri: `${directory}${index}-video.mp4`, audioUri: `${directory}${index}-audio.m4a`,
    exportUri: `${directory}${index}-video-export.mp4`, thumbnailUri: `${directory}${index}-thumbnail.jpg`,
    exportIncludesOverlays: true, resultSnapshot: snapshot,
  }));
  videos.forEach((video) => [video.uri, video.audioUri!, video.exportUri!, video.thumbnailUri!].forEach((uri) => files.add(uri)));
  values.set('whatz-it:round-videos:v1', JSON.stringify(videos));
  values.set('whatz-it:round-history:v1', JSON.stringify(videos.map((video) => ({
    id: video.roundId, deckId: video.deckId, createdAt: video.createdAt, resultSnapshot: snapshot,
  }))));
  const modules = new Map<string, object>();
  const load = (path: string): object => {
    const cached = modules.get(path);
    if (cached) return cached;
    const exported = {};
    modules.set(path, exported);
    const { code } = require('@babel/core').transformFileSync(resolve(path), {
      configFile: false, babelrc: false, presets: [['babel-preset-expo', { worklets: false }]],
    });
    // Route native dynamic imports through the same mocked module loader.
    const executable = code.replace(/import\((['"][^'"]+['"])\)/g, 'Promise.resolve(require($1))');
    runInNewContext(executable, { exports: exported, require: (name: string) => {
      if (name === '@react-native-async-storage/async-storage') return {
        getItem: async (key: string) => values.get(key) ?? null,
        setItem: async (key: string, value: string) => { values.set(key, value); },
      };
      if (name === 'react-native') return { Platform: { OS: 'android' } };
      if (name === 'expo-file-system') return { Directory, File, Paths: { document: 'file:///documents/' } };
      if (name.endsWith('/video-diagnostics')) return { logVideoDiagnostic() {}, warnVideoDiagnostic() {} };
      if (name.endsWith('/round-history')) return load('src/storage/round-history.ts');
      if (name.endsWith('/round-videos')) return load('src/video/round-videos.ts');
      return require(name);
    } });
    return exported;
  };
  return { files, values, videos,
    history: load('src/storage/round-history.ts') as typeof import('../storage/round-history'),
    media: load('src/video/round-videos.ts') as typeof import('./round-videos') };
}

it('removes old results and their source, audio, export, and thumbnail files, including after score-only rounds', async () => {
  const { history, media, videos, files, values } = storage();
  assert.equal((await history.loadRoundHistory()).length, 10);
  for (const video of videos.slice(0, 5)) {
    for (const uri of [video.uri, video.audioUri!, video.exportUri!, video.thumbnailUri!]) assert.equal(files.has(uri), false);
  }
  assert.equal(JSON.parse(values.get('whatz-it:round-videos:v1')!).length, 10);
  await history.saveRoundResult({ id: 'no-video', deckId: 'animals', createdAt: 16, resultSnapshot: snapshot });
  assert.equal(files.has(videos[5].exportUri!), false);
  assert.equal((await media.loadRoundVideos()).length, 9);
  assert.equal((await history.loadRoundHistory()).length, 10);
});

it('discards late video storage and finished exports for rounds outside the retained ten', async () => {
  const { history, media, videos, files } = storage();
  await history.loadRoundHistory();
  const old = videos[0];
  files.add(old.exportUri!);
  await media.prepareRoundVideoExport(old);
  assert.equal(files.has(old.exportUri!), false);
  const temporaryUri = 'file:///temporary/late.mp4';
  files.add(temporaryUri);
  await assert.rejects(media.storeRoundVideo(temporaryUri, undefined, 'animals', [], undefined,
    undefined, false, false, snapshot, old.roundId), /no longer/);
  assert.equal((await history.loadRoundHistory()).length, 10);
  assert.equal((await media.loadRoundVideos()).length, 10);
});
