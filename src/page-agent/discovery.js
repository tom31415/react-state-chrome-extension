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
import { isQueryClientLike } from './queryRegistry.js';

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

const WINDOW_QUERY_CLIENT_NAMES = ['queryClient', 'reactQueryClient'];

// Finds QueryClient instances the same way discoverStores finds Redux
// stores: QueryClientProvider's `client` prop (react-query has no
// enhancer-style interception point to shim ahead of time, so this and a
// window-global fallback are the only two entry points there are).
export function discoverQueryClients(registry, hookState) {
  const roots = collectRoots(hookState);

  for (const root of roots) {
    if (root.kind === 'fiber') {
      walkFiberTree(root.ref, (fiber) => {
        checkQueryClientCandidate(registry, fiber.memoizedProps);
      });
    } else {
      walkLegacyTree(root.ref, (inst) => {
        const el = inst._currentElement;
        if (el && typeof el.type === 'function') checkQueryClientCandidate(registry, el.props);
      });
    }
  }

  for (const name of WINDOW_QUERY_CLIENT_NAMES) {
    let candidate;
    try {
      candidate = window[name];
    } catch {
      continue;
    }
    if (isQueryClientLike(candidate)) registry.register(candidate, `window.${name}`);
  }
}

function checkQueryClientCandidate(registry, props) {
  if (!props || typeof props !== 'object') return;
  if (isQueryClientLike(props.client)) registry.register(props.client, 'QueryClientProvider');
}
