import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RoundSoundPlayback, type CuePlayer } from './round-sound-playback';

// Model ExoPlayer's ended state: it is not playing, but seeking restarts it
// unless pause() clears the retained playback intent first.
class EndedPlayer implements CuePlayer {
  playWhenReady = true;
  plays = 0;
  seeks = 0;
  volume = 1;
  seekFinished: Promise<void> = Promise.resolve();
  pause() { this.playWhenReady = false; }
  async seekTo() {
    this.seeks += 1;
    await this.seekFinished;
    if (this.playWhenReady) this.plays += 1;
  }
  play() { this.playWhenReady = true; this.plays += 1; }
}

test('preparing a second game never auto-plays any ended intro player', async () => {
  const lifecycle = new RoundSoundPlayback();
  const players = Array.from({ length: 5 }, () => new EndedPlayer());
  await Promise.all(players.map((player) => lifecycle.prepare(player, 1)));
  assert.deepEqual(players.map((player) => player.plays), [0, 0, 0, 0, 0]);
  for (const player of players) {
    assert.equal(await lifecycle.play(player, 1), true);
    assert.equal(player.plays, 1);
    assert.equal(player.seeks, 1, 'prepared cue plays without a seek on the countdown boundary');
  }
});

test('leaving during a pending seek cannot start old audio', async () => {
  const lifecycle = new RoundSoundPlayback();
  const player = new EndedPlayer();
  let finish!: () => void;
  player.seekFinished = new Promise((resolve) => { finish = resolve; });
  const played = lifecycle.play(player, 1);
  lifecycle.stop(player);
  finish();
  assert.equal(await played, false);
  assert.equal(player.plays, 0);
});

test('a newer request supersedes a queued replay on the same player', async () => {
  const lifecycle = new RoundSoundPlayback();
  const player = new EndedPlayer();
  let finish!: () => void;
  player.seekFinished = new Promise((resolve) => { finish = resolve; });
  const old = lifecycle.play(player, 1);
  const current = lifecycle.play(player, 1);
  finish();
  assert.deepEqual(await Promise.all([old, current]), [false, true]);
  assert.equal(player.plays, 1);
});

test('a countdown beat that is no longer visible cannot play after seeking', async () => {
  const lifecycle = new RoundSoundPlayback();
  const player = new EndedPlayer();
  let visible = true;
  const played = lifecycle.play(player, 1, () => visible);
  visible = false;
  assert.equal(await played, false);
  assert.equal(player.plays, 0);
});

test('stopping during preparation cannot prime a player for the next game', async () => {
  const lifecycle = new RoundSoundPlayback();
  const player = new EndedPlayer();
  const preparation = lifecycle.prepare(player, 0.4);
  lifecycle.stop(player);
  assert.equal(await preparation, false);
  await lifecycle.play(player, 0.4);
  assert.equal(player.seeks, 2);
  assert.equal(player.plays, 1);
});
