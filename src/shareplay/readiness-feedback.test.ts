import assert from 'node:assert/strict';
import test from 'node:test';
import { SharePlayReadinessFeedback } from './readiness-feedback';

test('confirmed Ready to Waiting emits once even with repeated snapshots', () => {
  const feedback = new SharePlayReadinessFeedback();
  assert.equal(feedback.update('session:player', false), false);
  assert.equal(feedback.update('session:player', true), false);
  assert.equal(feedback.update('session:player', false), true);
  assert.equal(feedback.update('session:player', false), false);
  assert.equal(feedback.update('session:player', true), false);
  assert.equal(feedback.update('session:player', false), true);
});

test('deck and host changes can replace the view before clearing readiness', () => {
  const feedback = new SharePlayReadinessFeedback();
  feedback.update('session:player', true);
  assert.equal(feedback.update('session:player', null), false);
  assert.equal(feedback.update('session:player', null), false);
  assert.equal(feedback.update('session:player', false), true);
});

test('temporary missing snapshots followed by preserved readiness do not alert', () => {
  const feedback = new SharePlayReadinessFeedback();
  feedback.update('session:player', true);
  feedback.update('session:player', null);
  assert.equal(feedback.update('session:player', true), false);
});

test('leaving, rejoining, and joining a different session establish a new baseline', () => {
  const feedback = new SharePlayReadinessFeedback();
  feedback.update('session:player', true);
  assert.equal(feedback.update(null, null), false);
  assert.equal(feedback.update('session:player', false), false);
  feedback.update('session:player', true);
  assert.equal(feedback.update('another:player', false), false);
});

test('finishing a round and returning to the lobby does not emit unready feedback', () => {
  const feedback = new SharePlayReadinessFeedback();
  feedback.update('session:player', true, 'lobby');
  assert.equal(feedback.update('session:player', true, 'countdown'), false);
  assert.equal(feedback.update('session:player', true, 'playing'), false);
  assert.equal(feedback.update('session:player', true, 'results'), false);
  feedback.update('session:player', null);
  assert.equal(feedback.update('session:player', false, 'lobby'), false);
  feedback.update('session:player', true, 'lobby');
  assert.equal(feedback.update('session:player', false, 'lobby'), true);
});
