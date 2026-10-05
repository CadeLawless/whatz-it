import assert from 'node:assert/strict';
import test from 'node:test';
import { ConnectionProbe, parseProbe } from './connection-probe';

test('all peers in a 32-person call can confirm their connection', () => {
  const probe = new ConnectionProbe('session', 'staging');
  const peers = Array.from({ length: 31 }, (_, i) => `peer-${i}`);
  probe.setPeers(peers);
  for (const id of peers) {
    const ping = probe.begin(id, id, 0)!;
    assert.ok(ping);
    probe.receive('session', id, ping.replace('ping', 'pong'), 100);
  }
  assert.equal(Object.keys(probe.snapshot()).length, 31);
  assert.ok(Object.values(probe.snapshot()).every((state) => state === 'confirmed'));
});

test('two participants confirm targeted round trips without treating send success as acceptance', () => {
  const host = new ConnectionProbe('session', 'staging');
  const guest = new ConnectionProbe('session', 'staging');
  host.setPeers(['guest']); guest.setPeers(['host']);
  const ping = host.begin('guest', 'request-1', 0)!;
  assert.equal(host.snapshot().guest, 'checking');
  const pong = guest.receive('session', 'host', ping, 100)!;
  assert.ok(pong);
  host.receive('session', 'guest', pong, 200);
  assert.equal(host.snapshot().guest, 'confirmed');
  assert.equal(guest.snapshot().host, 'unchecked');
  const reverse = guest.begin('host', 'request-2', 300)!;
  const reply = host.receive('session', 'guest', reverse, 350)!;
  guest.receive('session', 'host', reply, 400);
  assert.equal(guest.snapshot().host, 'confirmed');
});

test('old sessions, unknown senders, mismatched environments and unsolicited acknowledgments are ignored', () => {
  const probe = new ConnectionProbe('new', 'production'); probe.setPeers(['peer']);
  const ping = probe.begin('peer', 'current', 0)!;
  const pong = ping.replace('ping', 'pong');
  probe.receive('old', 'peer', pong, 1);
  probe.receive('new', 'stranger', pong, 1);
  probe.receive('new', 'peer', pong.replace('production', 'staging'), 1);
  probe.receive('new', 'peer', pong.replace('current', 'previous'), 1);
  assert.equal(probe.snapshot().peer, 'checking');
});

test('timeout, reconnect, reordered acknowledgments and duplicate delivery are bounded', () => {
  const probe = new ConnectionProbe('s', 'test'); probe.setPeers(['p']);
  const old = probe.begin('p', 'old', 0)!.replace('ping', 'pong');
  probe.expire(5001); assert.equal(probe.snapshot().p, 'timed-out');
  const current = probe.begin('p', 'current', 5100)!.replace('ping', 'pong');
  probe.receive('s', 'p', old, 5200); assert.equal(probe.snapshot().p, 'checking');
  probe.receive('s', 'p', current, 5300);
  probe.receive('s', 'p', current, 5400); assert.equal(probe.snapshot().p, 'confirmed');
  probe.setPeers([]); probe.setPeers(['p']); assert.equal(probe.snapshot().p, 'unchecked');
  probe.receive('s', 'p', current, 5500); assert.equal(probe.snapshot().p, 'unchecked');
});

test('wire validation rejects oversized, malformed and unexpected data', () => {
  for (const body of ['null', '[]', '{}', 'bad json', 'x'.repeat(513),
    JSON.stringify({ version: 2, kind: 'ping', nonce: 'n', environment: 'e' }),
    JSON.stringify({ version: 1, kind: 'ping', nonce: 'n', environment: 'e', answer: 'secret' })]) {
    assert.equal(parseProbe(body, 'e'), null);
  }
});

test('late replies fail and reply storms are rate limited', () => {
  const probe = new ConnectionProbe('s', 'e'); probe.setPeers(['p']);
  const ping = probe.begin('p', 'n', 0)!;
  probe.receive('s', 'p', ping.replace('ping', 'pong'), 6000);
  probe.expire(6000); assert.equal(probe.snapshot().p, 'timed-out');
  assert.ok(probe.receive('s', 'p', ping, 6000));
  assert.equal(probe.receive('s', 'p', ping, 6010), null);
  assert.ok(probe.receive('s', 'p', ping, 6300));
});

test('renewing confirmed peers stays green until timeout and removes stale responsiveness', () => {
  const probe = new ConnectionProbe('s', 'e'); probe.setPeers(['p']);
  const first = probe.begin('p', 'first', 0)!;
  probe.receive('s', 'p', first.replace('ping', 'pong'), 10);
  assert.equal(probe.snapshot().p, 'confirmed');
  probe.begin('p', 'renew', 6000);
  assert.equal(probe.snapshot().p, 'confirmed');
  probe.expire(11001);
  assert.equal(probe.snapshot().p, 'timed-out');
});
