// Registry of Redux(-like) stores found on the page, with live state pushes,
// path-based editing, and a bounded per-store action history for time-travel.
//
// Edit fidelity depends on how the store was found:
//   tier 1 (enhancer)   — reducer is wrapped: OVERRIDE_ACTION persists the edit.
//   tier 2 (explicit) / tier 3 (discovered) — getState is patched to return the
//   edited state and subscribers are poked with a no-op dispatch; the next real
//   action clears the override ("ephemeral").
//
// Every store's dispatch is wrapped EAGERLY at registration (not lazily, the
// way only the ephemeral-edit override used to be) so action history starts
// recording from the moment a store is found, for every tier uniformly —
// tier 1's override-clearing check is simply a no-op there, since tier 1
// edits go through the wrapped reducer instead and never set `override`.

import { serialize } from '../shared/serialize.js';
import { setIn } from '../shared/paths.js';
import { OVERRIDE_ACTION } from './reduxShim.js';

const NOTIFY_ACTION = '@@RRI/NOTIFY';
const UNSET = Symbol('unset');
const MAX_HISTORY = 50;

export function isStoreLike(o) {
  return !!(
    o &&
    (typeof o === 'object' || typeof o === 'function') &&
    typeof o.getState === 'function' &&
    typeof o.dispatch === 'function' &&
    typeof o.subscribe === 'function'
  );
}

export function throttle(fn, ms) {
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
  // Enhancers like applyMiddleware return a NEW object spreading the original
  // store, so object identity would register the same store twice — those
  // wrappers share the same own `getState` function, so key on it. But a
  // getState inherited from a prototype is shared across DISTINCT instances,
  // so fall back to the store object itself in that case.
  const byStore = new WeakMap();
  const dedupeKey = (store) =>
    Object.prototype.hasOwnProperty.call(store, 'getState') ? store.getState : store;
  let nextId = 1;

  function register(store, { tier = 3, label = null } = {}) {
    if (!isStoreLike(store)) return null;
    const existingId = byStore.get(dedupeKey(store));
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
      override: UNSET,
      baseState: undefined,
      realGetState: null,
      realDispatch: null,
      history: [], // ring buffer of { seq, type, action, state }, newest last
      historyTotal: 0,
      historyWanted: false,
    };
    entries.set(id, entry);
    byStore.set(dedupeKey(store), id);
    installDispatchPatch(entry);
    try {
      store.subscribe(throttle(() => pushState(entry), 150));
    } catch {
      // a store that can't be subscribed to still shows a snapshot on demand
    }
    if (isActive()) {
      send({ type: 'stores', stores: list() });
      pushState(entry);
    }
    return id;
  }

  // One dispatch wrapper per store, installed once, covering every tier:
  // records action history, and clears a stale ephemeral override the
  // moment a real action moves state off the snapshot it was computed from.
  function installDispatchPatch(entry) {
    const store = entry.store;
    entry.realGetState = store.getState.bind(store);
    entry.realDispatch = store.dispatch.bind(store);
    store.getState = () => (entry.override !== UNSET ? entry.override : entry.realGetState());
    store.dispatch = (action) => {
      const result = entry.realDispatch(action);
      const type = action && action.type;
      const isInternal = typeof type === 'string' && type.startsWith('@@RRI');
      if (!isInternal) {
        entry.override = UNSET;
        recordAction(entry, action);
      }
      return result;
    };
    // Middleware chains (thunks, sagas) capture the pre-patch dispatch in a
    // closure and never go through store.dispatch above — a plain action
    // dispatched from THAT closure updates real state without us seeing it.
    // We can't recover what action caused it (a subscription only reports
    // "state changed", not why) so it can't be added to the history, but we
    // CAN still notice the state moved and drop a stale override rather
    // than keep serving it.
    try {
      store.subscribe(() => {
        if (entry.override !== UNSET && entry.realGetState() !== entry.baseState) {
          entry.override = UNSET;
        }
      });
    } catch {
      // unsubscribable store: dispatch patching remains the only clearer
    }
    // getState/dispatch were just replaced; alias the new functions so a
    // rescan still dedupes this store.
    byStore.set(dedupeKey(store), entry.id);
  }

  // Kept agent-side only: `state` is the RAW (unserialized) value, needed to
  // actually jump back to it via the existing edit() path — reconstructing a
  // real value FROM its serialized form isn't possible here (reconstruct()
  // lives in the panel, a separate JS realm reachable only by message-
  // passing). Only {seq, type} — never the state — crosses that wire until
  // a jump is requested, and even then the state is applied locally and
  // observed through the normal store-state push, never sent as a blob.
  function recordAction(entry, action) {
    entry.historyTotal++;
    const record = {
      seq: entry.historyTotal,
      type: typeof (action && action.type) === 'string' ? action.type : '(unknown)',
      state: entry.realGetState(),
    };
    entry.history.push(record);
    if (entry.history.length > MAX_HISTORY) entry.history.shift();
    if (isActive() && entry.historyWanted) {
      send({
        type: 'store-action',
        storeId: entry.id,
        seq: record.seq,
        actionType: record.type,
        total: entry.historyTotal,
      });
    }
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

  function getHistory(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown store id ${id}`);
    entry.historyWanted = true;
    return {
      entries: entry.history.map((r) => ({ seq: r.seq, type: r.type })),
      total: entry.historyTotal,
    };
  }

  function clearHistory(id) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown store id ${id}`);
    entry.history = [];
    entry.historyTotal = 0;
  }

  // The deserialized (real) state at a specific history entry, for jumping
  // back to it. Returns undefined if that entry has scrolled out of the
  // ring buffer (see MAX_HISTORY).
  function getHistoryStateAt(id, seq) {
    const entry = entries.get(id);
    if (!entry) throw new Error(`Unknown store id ${id}`);
    const record = entry.history.find((r) => r.seq === seq);
    return record && record.state;
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
    entry.baseState = entry.realGetState();
    entry.override = newState;
    // Poke subscribers so connected components re-read (patched) getState.
    entry.realDispatch({ type: NOTIFY_ACTION });
  }

  return {
    register,
    list,
    get,
    edit,
    pushAll,
    pushState,
    getHistory,
    clearHistory,
    getHistoryStateAt,
  };
}
