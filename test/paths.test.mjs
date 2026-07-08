import test from 'node:test';
import assert from 'node:assert/strict';
import { getIn, setIn } from '../src/shared/paths.js';

test('getIn walks nested paths', () => {
  const obj = { a: { b: [{ c: 42 }] } };
  assert.equal(getIn(obj, ['a', 'b', '0', 'c']), 42);
  assert.equal(getIn(obj, ['a', 'missing', 'x']), undefined);
  assert.equal(getIn(obj, []), obj);
});

test('setIn replaces the root for an empty path', () => {
  assert.equal(setIn({ a: 1 }, [], 'new'), 'new');
});

test('setIn copies every container on the path and nothing else', () => {
  const before = { a: { b: 1 }, untouched: { z: 9 } };
  const after = setIn(before, ['a', 'b'], 2);
  assert.deepEqual(after, { a: { b: 2 }, untouched: { z: 9 } });
  assert.notEqual(after, before);
  assert.notEqual(after.a, before.a);
  assert.equal(after.untouched, before.untouched);
  assert.deepEqual(before, { a: { b: 1 }, untouched: { z: 9 } });
});

test('setIn indexes arrays with numeric string keys', () => {
  const before = { list: [1, 2, 3] };
  const after = setIn(before, ['list', '1'], 'two');
  assert.deepEqual(after.list, [1, 'two', 3]);
  assert.ok(Array.isArray(after.list));
  assert.deepEqual(before.list, [1, 2, 3]);
});

test('setIn rejects non-container parents', () => {
  assert.throws(() => setIn({ a: 5 }, ['a', 'b'], 1), /only plain objects\/arrays/);
  assert.throws(() => setIn({ a: new Date() }, ['a', 'b'], 1), /only plain objects\/arrays/);
});

test('setIn rejects bad array indices', () => {
  assert.throws(() => setIn([1, 2], ['x'], 1), /Invalid array index/);
});
