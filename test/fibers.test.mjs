import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDisplayName,
  nearestComposite,
  describeComponent,
  toCurrentFiber,
  getHostNode,
  mutateComponentProps,
  buildComponentTree,
} from '../src/page-agent/fibers.js';

class FakeClass {
  setState() {}
  forceUpdate() {
    this.forceUpdateCalls = (this.forceUpdateCalls || 0) + 1;
  }
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
  assert.equal(info.canEditProps, false, 'function components: no safe way to force a re-render');
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
  assert.equal(info.canEditProps, true, 'class components: forceUpdate() makes edits safely visible');
  assert.equal(info.key, 'k1');
  assert.deepEqual(info.state, { clicks: 3 });
  assert.deepEqual(info.hooks, []);
});

test('mutateComponentProps replaces the (frozen, as React dev builds do) props object rather than mutating it', () => {
  const instance = new FakeClass();
  const props = Object.freeze({ title: 'old', nested: { count: 1 } });
  instance.props = props;
  const fiber = {
    tag: 1,
    type: FakeClass,
    return: null,
    key: null,
    memoizedProps: props, // same reference, as React normally sets up
    pendingProps: props,
    memoizedState: {},
    stateNode: instance,
  };
  mutateComponentProps({ kind: 'fiber', ref: fiber }, ['nested', 'count'], 42);
  assert.equal(instance.props.nested.count, 42);
  assert.equal(fiber.memoizedProps.nested.count, 42, 'fiber memoizedProps stays in sync');
  assert.equal(fiber.pendingProps.nested.count, 42, 'fiber pendingProps stays in sync');
  assert.equal(instance.props, fiber.memoizedProps, 'instance and fiber point at the same new object');
  assert.notEqual(instance.props, props, 'the original frozen object was replaced, not mutated');
  assert.equal(props.nested.count, 1, 'the original frozen object is untouched');
  assert.equal(instance.forceUpdateCalls, 1);
});

test('mutateComponentProps rejects function components (no instance/forceUpdate)', () => {
  const fiber = { tag: 0, type: Named, return: null, memoizedProps: { a: 1 }, stateNode: null };
  assert.throws(
    () => mutateComponentProps({ kind: 'fiber', ref: fiber }, ['a'], 2),
    /Only class component props/
  );
});

test('mutateComponentProps works on a React 15 legacy instance, frozen props included', () => {
  const pub = new FakeClass();
  const props = Object.freeze({ label: 'hi' });
  pub.props = props;
  pub.state = {};
  const inst = { _currentElement: { type: Named, props, key: null, _owner: null }, _instance: pub };
  mutateComponentProps({ kind: 'legacy', ref: inst }, ['label'], 'bye');
  assert.equal(pub.props.label, 'bye');
  assert.equal(inst._currentElement.props.label, 'bye');
  assert.equal(pub.forceUpdateCalls, 1);
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
  assert.equal(info.canEditProps, true);
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

function legacyTree() {
  // TopLevelWrapper -> App -> Layout -> host div (div created by App via a
  // children prop, so its element _owner is App even though Layout is the
  // structural parent).
  function App() {}
  function Layout() {}
  const wrapper = { _currentElement: { type: function TopLevelWrapper() {} } };
  const app = { _currentElement: { type: App, _owner: null } };
  const layout = { _currentElement: { type: Layout, _owner: app } };
  const hostDiv = {
    _currentElement: { type: 'div', props: {}, _owner: app },
    _hostContainerInfo: { _topLevelWrapper: wrapper },
  };
  wrapper._renderedComponent = app;
  app._renderedComponent = layout;
  layout._renderedComponent = hostDiv;
  return { wrapper, app, layout, hostDiv };
}

test('React 15: nearestComposite returns the structural parent, not the element owner', () => {
  const { layout, hostDiv } = legacyTree();
  const found = nearestComposite({ kind: 'legacy', ref: hostDiv });
  assert.equal(found.ref, layout, 'children-prop element resolves to Layout, not creator App');
});

test('React 15: hoisted elements (owner null) still resolve via the tree walk', () => {
  const { layout, hostDiv } = legacyTree();
  hostDiv._currentElement._owner = null; // module-scope / constant-hoisted element
  const found = nearestComposite({ kind: 'legacy', ref: hostDiv });
  assert.equal(found.ref, layout);
});

test('React 15: detached instances fall back to the owner chain', () => {
  const owner = {
    _currentElement: { type: Named, props: {}, _owner: null },
    _instance: new FakeClass(),
  };
  const hostInst = { _currentElement: { type: 'div', props: {}, _owner: owner } };
  const found = nearestComposite({ kind: 'legacy', ref: hostInst });
  assert.equal(found.ref, owner);
});

test('getHostNode returns the first host descendant in tree (DFS) order', () => {
  const shallowLate = { tag: 5, stateNode: 'LATE', child: null, sibling: null, return: null };
  const deepFirst = { tag: 5, stateNode: 'FIRST', child: null, sibling: null, return: null };
  const inner = { tag: 0, type: Named, stateNode: null, child: deepFirst, sibling: shallowLate, return: null };
  const root = { tag: 0, type: Named, stateNode: null, child: inner, sibling: null, return: null, alternate: null };
  deepFirst.return = inner;
  inner.return = root;
  shallowLate.return = root;
  // BFS would visit shallowLate (depth 2) before deepFirst (depth 2 via child) —
  // ordering by tree position must pick FIRST.
  assert.equal(getHostNode({ kind: 'fiber', ref: root }), 'FIRST');
});

test('getHostNode highlights the parent element for text-only components', () => {
  const parent = { name: 'parentEl' };
  const textFiber = { tag: 6, stateNode: { parentElement: parent }, child: null, sibling: null, return: null };
  const root = { tag: 0, type: Named, stateNode: null, child: textFiber, sibling: null, return: null, alternate: null };
  textFiber.return = root;
  assert.equal(getHostNode({ kind: 'fiber', ref: root }), parent);
});

function registerCounter() {
  const registered = [];
  const register = (comp) => {
    const id = String(registered.length + 1);
    registered.push(comp);
    return id;
  };
  return { register, registered };
}

test('buildComponentTree collects composites, flattening through host elements', () => {
  //   root (HostRoot, no type)
  //     div (host, skipped)          -- sibling --> compC (class)
  //       compA (function, key "a")
  //         span (host, skipped)
  //           compB (function)
  const compB = { type: Named, child: null, sibling: null, key: null, stateNode: null };
  const hostSpan = { type: 'span', child: compB, sibling: null };
  const compA = { type: Named, child: hostSpan, sibling: null, key: 'a', stateNode: null };
  const compC = { type: FakeClass, child: null, sibling: null, key: null, stateNode: new FakeClass() };
  const hostDiv = { type: 'div', child: compA, sibling: compC };
  const root = { type: undefined, child: hostDiv, sibling: null };

  const { register, registered } = registerCounter();
  const result = buildComponentTree([{ kind: 'fiber', ref: root }], register);

  assert.equal(result.truncated, false);
  assert.equal(result.total, 3);
  assert.equal(registered.length, 3);
  assert.equal(result.roots.length, 2, 'div/span are skipped through, not counted as siblings');
  const [nodeA, nodeC] = result.roots;
  assert.equal(nodeA.name, 'Named');
  assert.equal(nodeA.kind, 'function');
  assert.equal(nodeA.key, 'a');
  assert.equal(nodeA.children.length, 1);
  assert.equal(nodeA.children[0].name, 'Named');
  assert.equal(nodeC.kind, 'class');
  assert.deepEqual(nodeC.children, []);
});

test('buildComponentTree with a fiber focusRef scopes to just that subtree', () => {
  const compB = { type: Named, child: null, sibling: null, key: null, stateNode: null };
  const hostSpan = { type: 'span', child: compB, sibling: null };
  const compA = { type: Named, child: hostSpan, sibling: null, key: 'a', stateNode: null };
  const compC = { type: FakeClass, child: null, sibling: null, key: null, stateNode: new FakeClass() };
  const hostDiv = { type: 'div', child: compA, sibling: compC };
  const root = { type: undefined, child: hostDiv, sibling: null };

  const { register, registered } = registerCounter();
  const result = buildComponentTree(
    [{ kind: 'fiber', ref: root }], // ignored entirely when focusRef is given
    register,
    { kind: 'fiber', ref: compA }
  );

  assert.equal(result.roots.length, 1, 'the focus target itself is the single root, unlike an ordinary root');
  assert.equal(result.roots[0].name, 'Named');
  assert.equal(result.roots[0].key, 'a');
  assert.equal(result.roots[0].children.length, 1);
  assert.equal(result.roots[0].children[0].name, 'Named');
  assert.equal(result.total, 2, 'compC (outside the focused subtree) is not walked at all');
  assert.equal(registered.length, 2);
});

test('buildComponentTree walks a React 15 legacy tree the same way, skipping a synthetic root wrapper', () => {
  const legacyLeaf = {
    _currentElement: { type: Named, key: null },
    _instance: {},
  };
  const legacyClass = {
    _currentElement: { type: FakeClass, key: 'k' },
    _instance: new FakeClass(),
    _renderedChildren: { 0: legacyLeaf },
  };
  // The "root" itself is a synthetic wrapper (composite-shaped but not a
  // real user component) — must be walked through, never emitted as a node.
  const topLevelWrapper = {
    _currentElement: { type: function TopLevelWrapper() {} },
    _renderedComponent: legacyClass,
  };

  const { register, registered } = registerCounter();
  const result = buildComponentTree([{ kind: 'legacy', ref: topLevelWrapper }], register);

  assert.equal(result.total, 2);
  assert.equal(registered.length, 2);
  assert.equal(result.roots.length, 1, 'the synthetic wrapper produced no node of its own');
  assert.equal(result.roots[0].name, 'FakeClass');
  assert.equal(result.roots[0].kind, 'class');
  assert.equal(result.roots[0].key, 'k');
  assert.equal(result.roots[0].children.length, 1);
  assert.equal(result.roots[0].children[0].kind, 'function');
});

test('buildComponentTree with a legacy focusRef emits the focus target itself, unlike an ordinary root', () => {
  const legacyLeaf = { _currentElement: { type: Named, key: null }, _instance: {} };
  const legacyClass = {
    _currentElement: { type: FakeClass, key: 'k' },
    _instance: new FakeClass(),
    _renderedChildren: { 0: legacyLeaf },
  };

  const { register, registered } = registerCounter();
  const result = buildComponentTree([], register, { kind: 'legacy', ref: legacyClass });

  assert.equal(result.roots.length, 1);
  assert.equal(result.roots[0].name, 'FakeClass');
  assert.equal(result.roots[0].kind, 'class');
  assert.equal(result.roots[0].children.length, 1);
  assert.equal(result.roots[0].children[0].name, 'Named');
  assert.equal(result.total, 2);
  assert.equal(registered.length, 2);
});

test('buildComponentTree caps total nodes and reports truncated', () => {
  // A long sibling chain of 5010 composite fibers under one root.
  let head = null;
  let prev = null;
  for (let i = 0; i < 5010; i++) {
    const fiber = { type: Named, child: null, sibling: null, key: null, stateNode: null };
    if (prev) prev.sibling = fiber;
    else head = fiber;
    prev = fiber;
  }
  const root = { type: undefined, child: head, sibling: null };

  const { register } = registerCounter();
  const result = buildComponentTree([{ kind: 'fiber', ref: root }], register);

  assert.equal(result.truncated, true);
  assert.equal(result.total, 5000);
  assert.equal(result.roots.length, 5000);
});
