import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmedFrom } from '../web/confirm.js';

const L = [{ tx_hash: 'aa', tx_pos: 0, height: 900000, value: 5 }, { tx_hash: 'bb', tx_pos: 1, height: 0, value: 5 }, { tx_hash: 'cc', tx_pos: 0, height: -1, value: 5 }];
test('confirmedFrom: height > 0 is confirmed, 0 and -1 are not', () => {
  assert.equal(confirmedFrom(L, 'aa', 0), true);
  assert.equal(confirmedFrom(L, 'bb', 1), false);
  assert.equal(confirmedFrom(L, 'cc', 0), false);
});
test('confirmedFrom: unknown output or odd answer -> null (do not block)', () => {
  assert.equal(confirmedFrom(L, 'aa', 1), null);
  assert.equal(confirmedFrom(null, 'aa', 0), null);
  assert.equal(confirmedFrom([{ tx_hash: 'aa', tx_pos: 0 }], 'aa', 0), null);
});
