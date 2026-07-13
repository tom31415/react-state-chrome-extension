import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSearchVisibility, pathKey } from '../src/devtools/panel/componentTree.js';

function node(name, children = []) {
  return { id: name, name, kind: 'function', key: null, children };
}

test('empty query means no filtering (null)', () => {
  const tree = [node('App', [node('Header')])];
  assert.equal(computeSearchVisibility(tree, ''), null);
  assert.equal(computeSearchVisibility(tree, '   '), null);
});

test('a match makes its own path visible', () => {
  const tree = [node('App', [node('Header'), node('Footer')])];
  const visible = computeSearchVisibility(tree, 'header');
  assert.ok(visible.has(pathKey([0, 0])), 'Header itself matches');
});

test('a descendant match keeps every ancestor visible too', () => {
  const tree = [node('App', [node('Layout', [node('SearchBar')])])];
  const visible = computeSearchVisibility(tree, 'search');
  assert.ok(visible.has(pathKey([0])), 'App is an ancestor of the match');
  assert.ok(visible.has(pathKey([0, 0])), 'Layout is an ancestor of the match');
  assert.ok(visible.has(pathKey([0, 0, 0])), 'SearchBar itself matches');
});

test('non-matching siblings without a matching descendant are excluded', () => {
  const tree = [node('App', [node('Header'), node('Footer')])];
  const visible = computeSearchVisibility(tree, 'header');
  assert.ok(!visible.has(pathKey([0, 1])), 'Footer has no match and is not an ancestor of one');
});

test('matching is a case-insensitive substring', () => {
  const tree = [node('UserProfileCard')];
  const visible = computeSearchVisibility(tree, 'PROFILE');
  assert.ok(visible.has(pathKey([0])));
});

test('no matches anywhere yields an empty (but non-null) visible set', () => {
  const tree = [node('App', [node('Header')])];
  const visible = computeSearchVisibility(tree, 'zzz-nomatch');
  assert.notEqual(visible, null);
  assert.equal(visible.size, 0);
});
