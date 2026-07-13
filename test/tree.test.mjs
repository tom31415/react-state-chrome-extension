import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstruct, formatPath, computeTreeSearchVisibility, pathKey } from '../src/devtools/panel/tree.js';
import { TAG } from '../src/shared/serialize.js';

test('reconstruct round-trips plain JSON', () => {
  const v = { a: [1, 'x', null], b: { c: true } };
  assert.deepEqual(reconstruct(v), v);
});

test('reconstruct unwraps obj wrappers (escaped/ctor-tagged objects)', () => {
  const node = { [TAG]: 'obj', ctor: 'Point', v: { x: 1, y: 2 } };
  assert.deepEqual(reconstruct(node), { x: 1, y: 2 });
});

test('reconstruct REFUSES key-truncated objects instead of silently dropping keys', () => {
  const node = { [TAG]: 'obj', total: 150, v: { k0: 1 } };
  assert.throws(() => reconstruct(node), /truncated/);
});

test('reconstruct refuses arrays containing truncation markers', () => {
  assert.throws(() => reconstruct([1, 2, { [TAG]: 'more', count: 25 }]), /truncated/);
});

test('reconstruct refuses truncated strings and depth stubs', () => {
  assert.throws(() => reconstruct({ [TAG]: 'str', v: 'abc', len: 9000 }), /truncated/);
  assert.throws(() => reconstruct({ [TAG]: 'depth', preview: '{a, b}' }), /truncated/);
});

test('reconstruct refuses non-JSON tagged values', () => {
  assert.throws(() => reconstruct({ [TAG]: 'fn', name: 'f' }), /Cannot reconstruct/);
  assert.throws(() => reconstruct({ [TAG]: 'undef' }), /not JSON/);
});

test('formatPath renders plain identifier segments with dot access', () => {
  assert.equal(formatPath('state', ['user', 'name']), 'state.user.name');
});

test('formatPath renders numeric segments as array indices', () => {
  assert.equal(formatPath('state', ['items', '0', 'label']), 'state.items[0].label');
});

test('formatPath bracket-quotes segments that are not valid identifiers', () => {
  assert.equal(formatPath('state', ['a-b']), 'state["a-b"]');
  assert.equal(formatPath('state', ['a b', '1x']), 'state["a b"]["1x"]');
});

test('formatPath with an empty path returns just the root label', () => {
  assert.equal(formatPath('state', []), 'state');
});

test('computeTreeSearchVisibility: empty query means no filtering (null)', () => {
  assert.equal(computeTreeSearchVisibility('state', { a: 1 }, ''), null);
  assert.equal(computeTreeSearchVisibility('state', { a: 1 }, '   '), null);
});

test('computeTreeSearchVisibility: a matching key stays visible along with its ancestors', () => {
  const tree = { user: { profile: { name: 'ada' }, age: 3 } };
  const visible = computeTreeSearchVisibility('state', tree, 'name');
  assert.ok(visible.has(pathKey([])), 'root is an ancestor of the match');
  assert.ok(visible.has(pathKey(['user'])), 'user is an ancestor of the match');
  assert.ok(visible.has(pathKey(['user', 'profile'])), 'profile is an ancestor of the match');
  assert.ok(visible.has(pathKey(['user', 'profile', 'name'])), 'name itself matches');
  assert.ok(!visible.has(pathKey(['user', 'age'])), 'age has no match and is not an ancestor of one');
});

test('computeTreeSearchVisibility matches case-insensitively on the root label too', () => {
  const visible = computeTreeSearchVisibility('myState', { a: 1 }, 'MYSTATE');
  assert.ok(visible.has(pathKey([])));
});

test('computeTreeSearchVisibility: no matches anywhere yields an empty (non-null) set', () => {
  const visible = computeTreeSearchVisibility('state', { a: 1 }, 'zzz-nomatch');
  assert.notEqual(visible, null);
  assert.equal(visible.size, 0);
});
