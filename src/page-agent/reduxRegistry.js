// Registry of Redux(-like) stores found on the page, with live state pushes
// and path-based editing.
//
// Edit fidelity depends on how the store was found:
//   tier 1 (enhancer)   — reducer is wrapped: OVERRIDE_ACTION persists the edit.
//   tier 2 (explicit) / tier 3 (discovered) — getState is patched to return the
//   edited state and subscribers are poked with a no-op dispatch; the next real
//   action clears the override ("ephemeral").

import { serialize } from '../shared/serialize.js';
import { setIn } from '../shared/paths.js';
import { OVERRIDE_ACTION } from './reduxShim.js';

const NOTIFY_ACTION = '@@RRI/NOTIFY';
const UNSET = Symbol('unset');

export function isStoreLike(o) {
  return !!(
    o &&
    (typeof o === 'object' || typeof o === 'function') &&
    typeof o.getState === 'function' &&
    typeof o.dispatch === 'function' &&
    typeof o.subscribe === 'function'
  );
}

function throttle(fn, ms) {
  let timer = null;
  let last = 0;
  return () => {
    const now = Date.now();
    if (timer) return;
    const wait = Math.max(0, ms - (now - last));
    timer = setTimeout(() => {
      timer = null;
      last = Date.now();
      fn();
    }, wait);
  };
}

export function createStoreRegistry(send, isActive) {
  const entries = new Map(); // id -> entry
  // Keyed by the store's getState function: enhancers like applyMiddleware
  // return a NEW object spreading the original store, so object identity would
  // register the same store twice — getState is shared across those wrappers.
  const byStore = new WeakMap();
  let nextId = 1;

  function register(store, { tier = 3, label = null } = {}) {
    if (!isStoreLike(store)) return null;
    const existingId = byStore.get(store.getState);
    if (existingId !== undefined) {
      const existing = entries.get(existingId);
      if (existing) {
        if (tier < existing.tier) existing.tier = tier;
        if (label && !existing.customLabel) {
          existing.label = label;
          existing.customLabel = true;
        }
      }
      return existingId;
    }
    const id = String(nextId++);
    const entry = {
      id,
      store,
      tier,
      label: label || `Store ${id}`,
      customLabel: !!label,
      patched: false,
      override: UNSET,
      realGetState: null,
      realDispatch: null,
    };
    entries.set(id, entry);
    byStore.set(store.getState, id);
    try {
      store.subscribe(throttle(() => pushState(entry), 150));
    } catch {
      // a store that can't be subscribed to still shows a snapshot on demand
    }
    if (isActive()) send({ type: 'stores', stores: list() });
    return id;
  }

  function pushState(entry) {
    if (!isActive() || !entries.has(entry.id)) return;
    let state;
    try {
      state = entry.store.getState();
    } catch (err) {
      send({ type: 'error', message: `getState failed for ${entry.label}: ${err}` });
      return;
    }
    send({
      type: 'store-state',
      storeId: entry.id,
      tier: entry.tier,
      state: serialize(state),
    });
  }

  function list() {
    return [...entries.values()].map((e) => ({ id: e.id, tier: e.tier, label: e.label }));
  }

  function get(id) {
    return entries.get(id) || null;
  }

  function pushAll() {
    for (const entry of entries.values()) pushState(entry);
  }

  // Applies `value` at `path` in the store's state. Returns 'persistent' or
  // 'ephemeral' depending on what the store supports.
  function edit(id, path, value) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown store id ${id}`);
    const next = setIn(entry.store.getState(), path, value);
    if (entry.tier === 1) {
      entry.store.dispatch({ type: OVERRIDE_ACTION, state: next });
      pushState(entry);
      return 'persistent';
    }
    ephemeralOverride(entry, next);
    pushState(entry);
    return 'ephemeral';
  }

  function ephemeralOverride(entry, newState) {
    const store = entry.store;
    if (!entry.patched) {
      entry.realGetState = store.getState.bind(store);
      entry.realDispatch = store.dispatch.bind(store);
      store.getState = () =>
        entry.override !== UNSET ? entry.override : entry.realGetState();
      store.dispatch = (action) => {
        const type = action && action.type;
        if (typeof type !== 'string' || !type.startsWith('@@RRI')) {
          entry.override = UNSET;
        }
        return entry.realDispatch(action);
      };
      entry.patched = true;
      // getState was just replaced; alias the new function so a rescan still
      // dedupes this store.
      byStore.set(store.getState, entry.id);
    }
    entry.override = newState;
    // Poke subscribers so connected components re-read (patched) getState.
    entry.realDispatch({ type: NOTIFY_ACTION });
  }

  return { register, list, get, edit, pushAll, pushState };
}
