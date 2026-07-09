import test from 'node:test';
import assert from 'node:assert/strict';
import { installReactHook, getRendererVersions } from '../src/page-agent/reactHook.js';

function withWindow(win, fn) {
  const had = 'window' in globalThis;
  const prev = globalThis.window;
  globalThis.window = win;
  try {
    return fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
}

test('hook installs, registers renderers, and tracks committed roots', () => {
  withWindow({}, () => {
    let commits = 0;
    const state = installReactHook(() => commits++);
    assert.equal(state.hookMode, 'ours');
    const hook = globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

    const id = hook.inject({ version: '18.3.1' });
    assert.ok(id >= 1);
    assert.deepEqual(getRendererVersions(state), ['18.3.1']);

    const root = { current: { child: {} } };
    hook.onCommitFiberRoot(id, root);
    assert.ok(state.fiberRoots.has(root));
    assert.equal(commits, 1);
  });
});

test('a root committing an empty tree (unmount) is pruned', () => {
  withWindow({}, () => {
    const state = installReactHook(null);
    const hook = globalThis.window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const root = { current: { child: {} } };
    hook.onCommitFiberRoot(1, root);
    assert.equal(state.fiberRoots.size, 1);
    root.current = { child: null };
    hook.onCommitFiberRoot(1, root);
    assert.equal(state.fiberRoots.size, 0, 'unmounted root removed');
  });
});

test('external hook mode taps onCommitFiberRoot without breaking the original', () => {
  let originalCalls = 0;
  const external = {
    renderers: new Map([[1, { version: '17.0.2' }]]),
    onCommitFiberRoot() {
      originalCalls++;
    },
  };
  withWindow({ __REACT_DEVTOOLS_GLOBAL_HOOK__: external }, () => {
    let commits = 0;
    const state = installReactHook(() => commits++);
    assert.equal(state.hookMode, 'external');
    assert.deepEqual(getRendererVersions(state), ['17.0.2']);

    const root = { current: { child: {} } };
    external.onCommitFiberRoot(1, root);
    assert.equal(originalCalls, 1, 'original hook still called');
    assert.equal(commits, 1, 'our tap fired');
    assert.ok(state.fiberRoots.has(root));
  });
});
