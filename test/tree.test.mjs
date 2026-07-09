import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstruct } from '../src/devtools/panel/tree.js';
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
