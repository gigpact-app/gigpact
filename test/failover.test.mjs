// web/failover.js: reads fail over to the next server and stick to the one that answered; a broadcast is never retried elsewhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { failoverProvider } from '../web/failover.js';

const mk = (name, { fail = false, hang = false, send } = {}) => {
  const calls = [];
  return {
    name, calls, network: 'mainnet',
    getUtxos: async (a) => { calls.push(['utxos', a]); if (hang) return new Promise(() => {}); if (fail) throw new Error(`${name} down`); return [`${name}:${a}`]; },
    getBlockHeight: async () => { calls.push(['tip']); if (fail) throw new Error(`${name} down`); return 100; },
    performRequest: async (...a) => { calls.push(['req', ...a]); if (fail) throw new Error(`${name} down`); return { by: name }; },
    sendRawTransaction: async (hex) => { calls.push(['send', hex]); if (send) return send(hex); return `${name}-txid`; },
  };
};

test('failover: the first server answers, the second is not asked', async () => {
  const a = mk('a'), b = mk('b'), p = failoverProvider([a, b]);
  assert.deepEqual(await p.getUtxos('x'), ['a:x']);
  assert.equal(await p.getBlockHeight(), 100);
  assert.equal(b.calls.length, 0);
  assert.equal(p.network, 'mainnet');
});

test('failover: a failing first server is skipped, and the second one is used first from then on', async () => {
  const a = mk('a', { fail: true }), b = mk('b'), p = failoverProvider([a, b]);
  assert.deepEqual(await p.getUtxos('x'), ['b:x']);
  assert.equal(p.current, 1);
  assert.deepEqual(await p.performRequest('m', 1), { by: 'b' });
  assert.equal(a.calls.length, 1, 'the dead server is not asked again');
});

test('failover: a server that never answers is skipped after the timeout', async () => {
  const a = mk('a', { hang: true }), b = mk('b'), p = failoverProvider([a, b], { timeoutMs: 30 });
  assert.deepEqual(await p.getUtxos('x'), ['b:x']);
});

test('failover: every server down -> the last error is thrown', async () => {
  const p = failoverProvider([mk('a', { fail: true }), mk('b', { fail: true })]);
  await assert.rejects(p.getBlockHeight(), /b down/);
});

test('failover: a broadcast goes to the current server only; a rejection is not retried on another server', async () => {
  const a = mk('a', { send: () => { throw new Error('bad-txns-inputs-missingorspent'); } }), b = mk('b'), p = failoverProvider([a, b]);
  await assert.rejects(p.sendRawTransaction('00'), /missingorspent/);
  assert.equal(b.calls.length, 0);
  const c = mk('c', { fail: true }), d = mk('d'), q = failoverProvider([c, d]);
  await q.getUtxos('x');                       // moves the current server to d
  assert.equal(await q.sendRawTransaction('01'), 'd-txid');
  assert.equal(c.calls.filter((x) => x[0] === 'send').length, 0);
});

test('failover: needs at least one provider', () => { assert.throws(() => failoverProvider([]), /at least one/); });
