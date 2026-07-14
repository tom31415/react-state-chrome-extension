// Page agent — runs in the page's MAIN world at document_start. Installs the
// React devtools hook and Redux shim before any app code runs, then answers
// panel requests relayed by the content bridge via window.postMessage.

import { installReactHook, getRendererVersions } from './reactHook.js';
import { installReduxShim } from './reduxShim.js';
import { createStoreRegistry } from './reduxRegistry.js';
import { createQueryRegistry } from './queryRegistry.js';
import { discoverStores, discoverQueryClients, collectRoots } from './discovery.js';
import { createPicker } from './picker.js';
import {
  describeComponent,
  getPublicInstance,
  getHostNode,
  describeElement,
  mutateComponentProps,
  buildComponentTree,
  toCurrentFiber,
  findUpdatedHostNodes,
} from './fibers.js';
import { serialize } from '../shared/serialize.js';
import { getIn, setIn } from '../shared/paths.js';
import { showHighlight, hideHighlight, flashUpdate } from './overlay.js';

(function main() {
  if (window.__RSI_AGENT__) return;
  window.__RSI_AGENT__ = true;

  let active = false; // a devtools panel is connected
  let lastRoots = [];

  function send(msg) {
    try {
      window.postMessage({ __rsi: 'to-panel', msg }, '*');
    } catch {
      // unserializable payloads should never happen (everything is pre-serialized)
    }
  }

  // The panel's own 'init' (whether user-triggered or auto-sent on
  // 'agent-ready') races the app's own bundle load/hydration and typically
  // fires before the app has mounted anything — so that first scan usually
  // finds nothing. Tier-1 (enhancer-registered) stores recover on their own
  // (registry.register pushes an update the moment a store is created while
  // active), but tier-3 (discovered via the React tree) stores are only ever
  // found by an explicit scan. Re-scanning on a throttle after React commits
  // — mounts, re-renders, SPA route changes — closes that gap.
  let rescanScheduled = false;
  function scheduleAutoRescan() {
    if (!active || rescanScheduled) return;
    rescanScheduled = true;
    setTimeout(() => {
      rescanScheduled = false;
      if (!active) return;
      scan();
      if (wantsComponentTree) sendComponentTree();
    }, 300);
  }

  // "Highlight updates" (a la React DevTools): opt-in, off by default — it's
  // visually noisy and only wanted while actively hunting re-renders. No
  // round trip to the panel needed; this is purely a page-side visual
  // effect driven straight off the same commit signal that drives rescans.
  let highlightUpdatesEnabled = false;
  function flashUpdatedComponents(root) {
    for (const node of findUpdatedHostNodes(root)) flashUpdate(node);
  }

  const hookState = installReactHook((root) => {
    scheduleAutoRescan();
    if (highlightUpdatesEnabled) flashUpdatedComponents(root);
  });
  const registry = createStoreRegistry(send, () => active);
  const queryRegistry = createQueryRegistry(send, () => active);
  installReduxShim((store) => registry.register(store, { tier: 1 }));

  // Public API for apps that want guaranteed registration.
  window.__REACT_STATE_INSPECTOR__ = {
    register: (store, label) => registry.register(store, { tier: 2, label }),
  };

  const components = new Map(); // id -> { comp, node }
  let nextComponentId = 1;
  let selectedComponentId = null; // protected from tree-rebuild eviction, below

  function isSameComponent(a, b) {
    if (a.kind !== b.kind) return false;
    return a.kind === 'fiber' ? toCurrentFiber(a.ref) === toCurrentFiber(b.ref) : a.ref === b.ref;
  }

  // If `comp` is the currently selected/displayed component, OR the
  // component the tree is currently focused on, reuse its existing id
  // instead of minting a new one — two cheap (O(1)) checks against ids
  // already protected from tree-rebuild eviction, not a scan of every
  // registered component. The selected-id reuse is what lets picking a
  // component on the page and finding the SAME component in the tree
  // converge on one id, so the panel can highlight the matching tree row.
  // The focus-id reuse is what lets a focused subtree survive a rebuild at
  // all — without it, the focus target would get a fresh id on every
  // throttled auto-refresh, breaking "stay focused" immediately.
  function registerComponent(comp, node = null) {
    for (const candidateId of [selectedComponentId, componentTreeFocusId]) {
      if (candidateId === null) continue;
      const candidateEntry = components.get(candidateId);
      if (candidateEntry && isSameComponent(candidateEntry.comp, comp)) {
        candidateEntry.comp = comp;
        if (node) candidateEntry.node = node;
        return candidateId;
      }
    }
    const id = String(nextComponentId++);
    components.set(id, { comp, node });
    return id;
  }

  const picker = createPicker({
    onPick(comp, node) {
      send({ type: 'pick-state', picking: false });
      try {
        sendComponent(registerComponent(comp, node));
        // Picking alone triggers no React commit, so nothing would otherwise
        // rebuild the tree — do it now so the tree (if requested) picks up
        // registerComponent's id-reuse and can highlight the matching row
        // right away instead of waiting on some unrelated future re-render.
        if (wantsComponentTree) sendComponentTree();
      } catch (err) {
        send({
          type: 'error',
          inResponseTo: 'pick',
          message: `Could not read the selected component: ${String((err && err.message) || err)}`,
        });
      }
    },
    onCancel(reason) {
      send({ type: 'pick-state', picking: false, reason: reason || null });
    },
  });

  function sendComponent(id) {
    const entry = components.get(id);
    if (!entry) throw new Error('Component reference is gone (page may have re-rendered).');
    const info = describeComponent(entry.comp);
    selectedComponentId = id;
    send({
      type: 'component-selected',
      id,
      dom: entry.node ? describeElement(entry.node) : null,
      ...info,
    });
  }

  // Every tree rebuild assigns fresh ids (fibers are ephemeral and re-created
  // on re-render, so ids can't be kept stable across rebuilds) — the
  // previous generation's ids are evicted from `components` so a page with
  // frequent re-renders doesn't accumulate them forever. The currently
  // *selected* component, and the tree's current *focus* target (see the
  // panel's "Focus" row action), are exempted: without that, a background
  // auto-rescan mid-edit — or mid-focus — would evict the very component
  // the panel is showing or scoped to.
  let wantsComponentTree = false;
  let componentTreeFocusId = null;
  let lastTreeIds = new Set();

  function sendComponentTree() {
    for (const id of lastTreeIds) {
      if (id !== selectedComponentId && id !== componentTreeFocusId) components.delete(id);
    }
    lastTreeIds = new Set();

    let focusRef = null;
    if (componentTreeFocusId !== null) {
      const focusEntry = components.get(componentTreeFocusId);
      if (focusEntry) focusRef = focusEntry.comp;
      else componentTreeFocusId = null; // focus target is gone — fall back to the full tree
    }

    const result = buildComponentTree(
      focusRef ? null : collectRoots(hookState),
      (comp) => {
        const id = registerComponent(comp);
        lastTreeIds.add(id);
        return id;
      },
      focusRef
    );
    send({
      type: 'component-tree',
      roots: result.roots,
      truncated: result.truncated,
      total: result.total,
      focusId: componentTreeFocusId,
    });
  }

  function scan() {
    lastRoots = discoverStores(registry, hookState);
    discoverQueryClients(queryRegistry, hookState);
  }

  function sendEnvironment() {
    const versions = getRendererVersions(hookState);
    if (versions.length === 0) {
      for (const root of lastRoots) {
        versions.push(root.kind === 'legacy' ? '15.x (legacy instance)' : '16+ (fiber)');
      }
    }
    send({
      type: 'environment',
      reactDetected: lastRoots.length > 0 || versions.length > 0,
      reactVersions: [...new Set(versions)],
      hookMode: hookState.hookMode,
      href: location.href,
    });
  }

  function fullSync() {
    scan();
    sendEnvironment();
    send({ type: 'stores', stores: registry.list() });
    registry.pushAll();
    queryRegistry.pushAll();
    if (wantsComponentTree) sendComponentTree();
  }

  function ackQueryAction(action, fn) {
    try {
      fn();
      send({ type: 'query-action-result', action, ok: true });
    } catch (err) {
      send({ type: 'query-action-result', action, ok: false, error: String((err && err.message) || err) });
    }
  }

  const handlers = {
    init() {
      active = true;
      fullSync();
    },
    rescan() {
      fullSync();
    },
    'panel-disconnected': () => {
      active = false;
      picker.stop();
      hideHighlight();
    },
    'edit-state'(msg) {
      let mode;
      try {
        const value = JSON.parse(msg.json);
        mode = registry.edit(msg.storeId, msg.path, value);
      } catch (err) {
        send({
          type: 'edit-result',
          storeId: msg.storeId,
          ok: false,
          error: String((err && err.message) || err),
        });
        return;
      }
      send({ type: 'edit-result', storeId: msg.storeId, ok: true, mode });
    },
    'get-slice'(msg) {
      const entry = registry.get(msg.storeId);
      if (!entry) throw new Error(`Unknown store id ${msg.storeId}`);
      const node = serialize(getIn(entry.store.getState(), msg.path));
      send({ type: 'slice', storeId: msg.storeId, path: msg.path, node });
    },
    'get-store-history'(msg) {
      const { entries, total } = registry.getHistory(msg.storeId);
      send({ type: 'store-history', storeId: msg.storeId, entries, total });
    },
    'clear-store-history'(msg) {
      registry.clearHistory(msg.storeId);
      send({ type: 'store-history', storeId: msg.storeId, entries: [], total: 0 });
    },
    'jump-to-action'(msg) {
      const state = registry.getHistoryStateAt(msg.storeId, msg.seq);
      if (state === undefined) {
        throw new Error('That action has scrolled out of history and can no longer be restored.');
      }
      let mode;
      try {
        mode = registry.edit(msg.storeId, [], state);
      } catch (err) {
        send({
          type: 'edit-result',
          storeId: msg.storeId,
          ok: false,
          error: String((err && err.message) || err),
        });
        return;
      }
      send({ type: 'edit-result', storeId: msg.storeId, ok: true, mode });
    },
    'start-pick'() {
      picker.start();
      send({ type: 'pick-state', picking: true });
    },
    'stop-pick'() {
      picker.stop();
      send({ type: 'pick-state', picking: false });
    },
    'highlight-component'(msg) {
      const entry = components.get(msg.id);
      const node = entry && (entry.node?.isConnected ? entry.node : getHostNode(entry.comp));
      if (node) showHighlight(node, null);
    },
    'clear-highlight'() {
      hideHighlight();
    },
    'set-component-state'(msg) {
      const entry = components.get(msg.id);
      if (!entry) throw new Error('Component reference is gone (page may have re-rendered).');
      const instance = getPublicInstance(entry.comp);
      if (!instance || typeof instance.setState !== 'function') {
        throw new Error('Only class component state can be edited.');
      }
      const value = JSON.parse(msg.json);
      const nextState = setIn(instance.state, msg.path, value);
      instance.setState(nextState, () => {
        try {
          sendComponent(msg.id);
        } catch {
          // component unmounted between setState and callback
        }
      });
    },
    'set-component-props'(msg) {
      const entry = components.get(msg.id);
      if (!entry) throw new Error('Component reference is gone (page may have re-rendered).');
      const value = JSON.parse(msg.json);
      mutateComponentProps(entry.comp, msg.path, value);
      sendComponent(msg.id);
    },
    'get-component-tree'(msg) {
      wantsComponentTree = true;
      // The key is omitted by callers that just want a rebuild with
      // whatever focus is already set (tab-switch, rescan); it's present
      // (a string id, or null) only when the panel is actually changing focus.
      if (msg && Object.prototype.hasOwnProperty.call(msg, 'focusId')) {
        componentTreeFocusId = msg.focusId;
      }
      sendComponentTree();
    },
    'select-component'(msg) {
      sendComponent(msg.id);
    },
    'set-highlight-updates'(msg) {
      highlightUpdatesEnabled = !!msg.enabled;
    },
    'get-query-detail'(msg) {
      const detail = queryRegistry.getQueryDetail(msg.id);
      send(detail ? { type: 'query-detail', ...detail } : { type: 'query-detail', id: msg.id, gone: true });
    },
    'get-mutation-detail'(msg) {
      const detail = queryRegistry.getMutationDetail(msg.id);
      send(detail ? { type: 'mutation-detail', ...detail } : { type: 'mutation-detail', id: msg.id, gone: true });
    },
    'refetch-query'(msg) {
      ackQueryAction('refetch', () => queryRegistry.refetchQuery(msg.id));
    },
    'invalidate-query'(msg) {
      ackQueryAction('invalidate', () => queryRegistry.invalidateQuery(msg.id));
    },
    'reset-query'(msg) {
      ackQueryAction('reset', () => queryRegistry.resetQuery(msg.id));
    },
    'remove-query'(msg) {
      ackQueryAction('remove', () => queryRegistry.removeQuery(msg.id));
    },
    'remove-mutation'(msg) {
      ackQueryAction('remove-mutation', () => queryRegistry.removeMutation(msg.id));
    },
    'edit-query-data'(msg) {
      try {
        const value = JSON.parse(msg.json);
        queryRegistry.editQueryData(msg.id, msg.path, value);
        send({ type: 'query-edit-result', id: msg.id, ok: true });
      } catch (err) {
        send({ type: 'query-edit-result', id: msg.id, ok: false, error: String((err && err.message) || err) });
      }
    },
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.__rsi !== 'to-agent') return;
    const msg = event.data.msg || {};
    const handler = handlers[msg.type];
    if (!handler) return;
    try {
      handler(msg);
    } catch (err) {
      send({
        type: 'error',
        inResponseTo: msg.type,
        message: String((err && err.message) || err),
      });
    }
  });

  // Let an already-open panel know a fresh page is ready (deferred so the
  // content bridge, which also runs at document_start, is listening).
  setTimeout(() => send({ type: 'agent-ready' }), 0);

  // Restored from the back/forward cache: the panel may be showing another
  // page's data — announce again so it resets and re-inits.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) send({ type: 'agent-ready' });
  });
})();
