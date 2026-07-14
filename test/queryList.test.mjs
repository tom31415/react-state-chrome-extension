import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, deriveBadge } from '../src/devtools/panel/queryList.js';

test('matchesQuery matches on keyDisplay, case-insensitively', () => {
  const row = { keyDisplay: '["user","1"]', clientLabel: null };
  assert.ok(matchesQuery(row, ''));
  assert.ok(matchesQuery(row, 'USER'));
  assert.ok(!matchesQuery(row, 'todo'));
});

test('matchesQuery also matches on clientLabel when present', () => {
  const row = { keyDisplay: '["a"]', clientLabel: 'Admin client' };
  assert.ok(matchesQuery(row, 'admin'));
});

test('deriveBadge: error status always wins', () => {
  assert.equal(deriveBadge({ status: 'error', fetchStatus: 'fetching', isStale: true }), 'error');
});

test('deriveBadge: fetchStatus fetching or status pending means "fetching"', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'fetching', isStale: false }), 'fetching');
  assert.equal(deriveBadge({ status: 'pending', fetchStatus: 'idle', isStale: false }), 'fetching');
});

test('deriveBadge: stale beats fresh when not fetching or errored', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'idle', isStale: true }), 'stale');
});

test('deriveBadge: fresh is the default', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'idle', isStale: false }), 'fresh');
});

test('deriveBadge: a mutation row (no fetchStatus/isStale) badges fresh unless errored', () => {
  assert.equal(deriveBadge({ status: 'success' }), 'fresh');
  assert.equal(deriveBadge({ status: 'error' }), 'error');
});
