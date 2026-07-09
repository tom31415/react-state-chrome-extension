// Installs a minimal __REACT_DEVTOOLS_GLOBAL_HOOK__ when none exists, so React
// (15+) registers its renderer with us and React 16+ reports fiber roots on
// every commit. If the real React DevTools hook is already installed we leave
// it alone and read what we can from it; DOM scanning covers the rest.

// A root unmount commits with an empty tree — drop it then so rescans don't
// keep walking dead trees (and holding their detached DOM alive).
function trackRoot(state, root) {
  if (!root) return;
  if (root.current && root.current.child === null) state.fiberRoots.delete(root);
  else state.fiberRoots.add(root);
}

export function installReactHook(onCommit) {
  const state = {
    renderers: new Map(),
    fiberRoots: new Set(),
    hookMode: 'ours',
  };

  const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing) {
    // Another devtools (usually React DevTools) owns the hook. Read its
    // renderers and tap its commit callback so we still learn about live
    // fiber roots — the DOM scan alone misses trees rooted at <html>
    // synthesized portals, etc.
    state.hookMode = 'external';
    if (existing.renderers && typeof existing.renderers.forEach === 'function') {
      state.renderers = existing.renderers;
    }
    try {
      const originalCommit = existing.onCommitFiberRoot;
      existing.onCommitFiberRoot = function (id, root, ...rest) {
        try {
          trackRoot(state, root);
          if (onCommit) onCommit();
        } catch {
          // never break the host hook
        }
        return typeof originalCommit === 'function'
          ? originalCommit.call(this, id, root, ...rest)
          : undefined;
      };
    } catch {
      // hook object is frozen; DOM scanning remains the fallback
    }
    return state;
  }

  let uid = 0;
  const hook = {
    renderers: state.renderers,
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      const id = ++uid;
      state.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, root) {
      trackRoot(state, root);
      if (onCommit) onCommit();
    },
    onCommitFiberUnmount() {},
    onScheduleFiberRoot() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    on() {},
    off() {},
    emit() {},
    sub() {
      return () => {};
    },
    getFiberRoots() {
      return state.fiberRoots;
    },
  };

  try {
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      enumerable: false,
      value: hook,
      writable: true,
    });
  } catch {
    state.hookMode = 'none';
  }
  return state;
}

export function getRendererVersions(state) {
  const versions = [];
  try {
    state.renderers.forEach((renderer) => {
      if (renderer && renderer.version) versions.push(String(renderer.version));
      else versions.push('unknown');
    });
  } catch {
    // renderers of an external hook may not be iterable
  }
  return versions;
}
