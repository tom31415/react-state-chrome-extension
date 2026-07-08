import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDisplayName,
  nearestComposite,
  describeComponent,
  toCurrentFiber,
} from '../src/page-agent/fibers.js';

class FakeClass {
  setState() {}
}
FakeClass.prototype.isReactComponent = {};

function Named() {}

test('getDisplayName covers functions, strings, memo and forwardRef', () => {
  assert.equal(getDisplayName('div'), 'div');
  assert.equal(getDisplayName(Named), 'Named');
  const withDisplay = () => {};
  withDisplay.displayName = 'Fancy';
  assert.equal(getDisplayName(withDisplay), 'Fancy');
  assert.equal(getDisplayName({ render: Named }), 'ForwardRef(Named)');
  assert.equal(getDisplayName({ type: Named, compare: null }), 'Memo(Named)');
  assert.equal(getDisplayName(undefined), 'Unknown');
});

test('nearestComposite walks fiber returns past host fibers', () => {
  const componentFiber = { tag: 0, type: Named, return: null };
  const hostFiber = { tag: 5, type: 'div', return: componentFiber };
  const found = nearestComposite({ kind: 'fiber', ref: hostFiber });
  assert.equal(found.ref, componentFiber);
});

test('describeComponent reads a function fiber with hooks', () => {
  const hook2 = { memoizedState: 'second', queue: {}, next: null };
  const fiber = {
    tag: 0,
    type: Named,
    return: null,
    key: null,
    memoizedProps: { title: 'hello' },
    memoizedState: { memoizedState: 41, queue: {}, next: hook2 },
    stateNode: null,
  };
  const info = describeComponent({ kind: 'fiber', ref: fiber });
  assert.equal(info.name, 'Named');
  assert.equal(info.kind, 'function');
  assert.equal(info.canEditState, false);
  assert.deepEqual(info.props, { title: 'hello' });
  assert.equal(info.hooks.length, 2);
  assert.equal(info.hooks[0].value, 41);
  assert.equal(info.hooks[1].value, 'second');
});

test('describeComponent reads a class fiber state', () => {
  const instance = new FakeClass();
  const fiber = {
    tag: 1,
    type: FakeClass,
    return: null,
    key: 'k1',
    memoizedProps: {},
    memoizedState: { clicks: 3 },
    stateNode: instance,
  };
  const info = describeComponent({ kind: 'fiber', ref: fiber });
  assert.equal(info.kind, 'class');
  assert.equal(info.canEditState, true);
  assert.equal(info.key, 'k1');
  assert.deepEqual(info.state, { clicks: 3 });
  assert.deepEqual(info.hooks, []);
});

test('describeComponent reads a React 15 internal instance', () => {
  const pub = new FakeClass();
  pub.state = { open: true };
  const inst = {
    _currentElement: { type: Named, props: { a: 1 }, key: null, _owner: null },
    _instance: pub,
  };
  const info = describeComponent({ kind: 'legacy', ref: inst });
  assert.equal(info.name, 'Named');
  assert.equal(info.reactKind, 'legacy');
  assert.equal(info.kind, 'class');
  assert.equal(info.canEditState, true);
  assert.deepEqual(info.props, { a: 1 });
  assert.deepEqual(info.state, { open: true });
});

test('describeComponent resolves the current fiber generation after a re-render', () => {
  // Two generations of a small tree sharing one FiberRoot, as React builds them.
  const fiberRoot = {};
  const staleRoot = { tag: 3, return: null, stateNode: fiberRoot, child: null, sibling: null };
  const currentRoot = { tag: 3, return: null, stateNode: fiberRoot, child: null, sibling: null, alternate: staleRoot };
  staleRoot.alternate = currentRoot;
  fiberRoot.current = currentRoot;

  const instance = new FakeClass();
  const stale = {
    tag: 1,
    type: FakeClass,
    return: staleRoot,
    child: null,
    sibling: null,
    key: null,
    memoizedProps: {},
    memoizedState: { clicks: 0 },
    stateNode: instance,
  };
  const current = { ...stale, return: currentRoot, memoizedState: { clicks: 42 }, alternate: stale };
  stale.alternate = current;
  staleRoot.child = stale;
  currentRoot.child = current;
  // The mount-time instance pointer stays on the stale generation — it must not win.
  instance._reactInternals = stale;

  assert.equal(toCurrentFiber(stale), current);
  assert.equal(toCurrentFiber(current), current);
  assert.equal(toCurrentFiber(null), null);
  const info = describeComponent({ kind: 'fiber', ref: stale });
  assert.deepEqual(info.state, { clicks: 42 });
});

test('nearestComposite follows the owner chain for React 15 host instances', () => {
  const owner = {
    _currentElement: { type: Named, props: {}, _owner: null },
    _instance: new FakeClass(),
  };
  const hostInst = { _currentElement: { type: 'div', props: {}, _owner: owner } };
  const found = nearestComposite({ kind: 'legacy', ref: hostInst });
  assert.equal(found.ref, owner);
});
