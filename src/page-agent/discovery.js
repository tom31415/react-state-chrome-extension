// Finds React roots and Redux stores that weren't created through our
// devtools shim: react-redux Providers carry the store in props or in their
// context value, and debugging setups often expose a store on window.

import {
  findReactRootsInDom,
  walkFiberTree,
  walkLegacyTree,
  getDisplayName,
} from './fibers.js';
import { isStoreLike } from './reduxRegistry.js';

const WINDOW_STORE_NAMES = ['store', 'reduxStore', 'appStore', '__store__', '_store'];

// Roots from the devtools hook (live fiber roots) plus a DOM scan fallback.
export function collectRoots(hookState) {
  const roots = [];
  const seen = new Set();
  for (const fiberRoot of hookState.fiberRoots) {
    const fiber = fiberRoot.current;
    if (fiber && !seen.has(fiber)) {
      seen.add(fiber);
      roots.push({ kind: 'fiber', ref: fiber });
    }
  }
  for (const root of findReactRootsInDom()) {
    if (!seen.has(root.ref)) {
      seen.add(root.ref);
      roots.push(root);
    }
  }
  return roots;
}

export function discoverStores(registry, hookState) {
  const roots = collectRoots(hookState);

  for (const root of roots) {
    if (root.kind === 'fiber') {
      walkFiberTree(root.ref, (fiber) => {
        const props = fiber.memoizedProps;
        checkCandidates(registry, props, () => getDisplayName(fiber.type));
      });
    } else {
      walkLegacyTree(root.ref, (inst) => {
        const el = inst._currentElement;
        if (el && typeof el.type === 'function') {
          checkCandidates(registry, el.props, () => getDisplayName(el.type));
        }
      });
    }
  }

  for (const name of WINDOW_STORE_NAMES) {
    let candidate;
    try {
      candidate = window[name];
    } catch {
      continue;
    }
    if (isStoreLike(candidate)) {
      registry.register(candidate, { tier: 3, label: `window.${name}` });
    }
  }

  return roots;
}

function checkCandidates(registry, props, componentName) {
  if (!props || typeof props !== 'object') return;
  if (isStoreLike(props.store)) {
    const name = componentName();
    const label = name && name !== 'Anonymous' ? `${name} store` : 'Provider store';
    registry.register(props.store, { tier: 3, label });
  }
  // react-redux >= 6: <ReactReduxContext.Provider value={{ store, subscription }}>
  const value = props.value;
  if (value && typeof value === 'object' && isStoreLike(value.store)) {
    registry.register(value.store, { tier: 3, label: 'react-redux context store' });
  }
}
