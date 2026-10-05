import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanPlayerName, encodePlayerName, parsePlayerName } from './player-names';

test('a player name is short, normalized, and safe to send', () => {
  assert.equal(cleanPlayerName('  Alex\n\t Rivera  '), 'Alex Rivera');
  assert.equal(parsePlayerName(encodePlayerName('  Alex Rivera  ')), 'Alex Rivera');
  assert.equal(cleanPlayerName('a'.repeat(40)).length, 32);
});

test('player-name wire messages reject unrelated or malformed data', () => {
  assert.equal(parsePlayerName('{"version":1,"kind":"player-name","name":""}'), '');
  assert.equal(parsePlayerName('{"version":1,"kind":"player-name","name":" Alex "}'), null);
  assert.equal(parsePlayerName('{"version":1,"kind":"player-name","name":"Alex","senderId":"other"}'), null);
  assert.equal(parsePlayerName('{"version":3,"kind":"view"}'), null);
});
