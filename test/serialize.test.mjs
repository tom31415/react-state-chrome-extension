import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize, TAG, isTagged, MAX_ITEMS, MAX_KEYS } from '../src/shared/serialize.js';

test('primitives pass through', () => {
  assert.equal(serialize(1), 1);
  assert.equal(serialize('a'), 'a');
  assert.equal(serialize(true), true);
  assert.equal(serialize(null), null);
});

test('special values become tagged nodes', () => {
  assert.deepEqual(serialize(undefined), { [TAG]: 'undef' });
  assert.deepEqual(serialize(NaN), { [TAG]: 'num', v: 'NaN' });
  assert.deepEqual(serialize(Infinity), { [TAG]: 'num', v: 'Infinity' });
  assert.deepEqual(serialize(10n), { [TAG]: 'bigint', v: '10' });
  assert.deepEqual(serialize(function hello() {}), { [TAG]: 'fn', name: 'hello' });
  assert.equal(serialize(new Date('2026-07-08T00:00:00Z')).v, '2026-07-08T00:00:00.000Z');
});

test('plain objects and arrays stay plain', () => {
  assert.deepEqual(serialize({ a: [1, 'x'], b: { c: null } }), { a: [1, 'x'], b: { c: null } });
});

test('cycles are cut', () => {
  const o = { name: 'root' };
  o.self = o;
  assert.deepEqual(serialize(o), { name: 'root', self: { [TAG]: 'circular' } });
});

test('shared (non-cyclic) references serialize fully', () => {
  const shared = { v: 1 };
  const out = serialize({ a: shared, b: shared });
  assert.deepEqual(out, { a: { v: 1 }, b: { v: 1 } });
});

test('depth is capped with a preview node', () => {
  let deep = { end: true };
  for (let i = 0; i < 20; i++) deep = { next: deep };
  let cur = serialize(deep);
  let levels = 0;
  while (cur && cur.next) {
    cur = cur.next;
    levels++;
  }
  assert.ok(levels > 0 && levels <= 8);
  assert.equal(cur[TAG], 'depth');
});

test('long arrays are truncated with a more marker', () => {
  const out = serialize(Array.from({ length: MAX_ITEMS + 25 }, (_, i) => i));
  assert.equal(out.length, MAX_ITEMS + 1);
  assert.deepEqual(out[MAX_ITEMS], { [TAG]: 'more', count: 25 });
});

test('wide objects are wrapped with a total', () => {
  const big = {};
  for (let i = 0; i < MAX_KEYS + 10; i++) big[`k${i}`] = i;
  const out = serialize(big);
  assert.equal(out[TAG], 'obj');
  assert.equal(out.total, MAX_KEYS + 10);
  assert.equal(Object.keys(out.v).length, MAX_KEYS);
});

test('objects containing the tag key are escaped', () => {
  const out = serialize({ [TAG]: 'sneaky', x: 1 });
  assert.equal(out[TAG], 'obj');
  assert.deepEqual(out.v, { [TAG]: 'sneaky', x: 1 });
});

test('class instances record their constructor', () => {
  class Point {
    constructor() {
      this.x = 1;
    }
  }
  const out = serialize(new Point());
  assert.equal(out[TAG], 'obj');
  assert.equal(out.ctor, 'Point');
  assert.deepEqual(out.v, { x: 1 });
});

test('maps and sets serialize entries', () => {
  const out = serialize(new Map([['k', 1]]));
  assert.equal(out[TAG], 'map');
  assert.deepEqual(out.entries, [['k', 1]]);
  const s = serialize(new Set([1, 2]));
  assert.equal(s[TAG], 'set');
  assert.deepEqual(s.values, [1, 2]);
});

test('isTagged discriminates correctly', () => {
  assert.ok(isTagged({ [TAG]: 'undef' }));
  assert.ok(!isTagged({ a: 1 }));
  assert.ok(!isTagged([1]));
  assert.ok(!isTagged(null));
  assert.ok(!isTagged('x'));
});
