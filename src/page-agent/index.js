// Page agent — runs in the page's MAIN world at document_start. Installs the
// React devtools hook and Redux shim before any app code runs, then answers
// panel requests relayed by the content bridge via window.postMessage.

import { installReactHook, getRendererVersions } from './reactHook.js';
import { installReduxShim } from './reduxShim.js';
import { createStoreRegistry } from './reduxRegistry.js';
import { discoverStores } from './discovery.js';
import { createPicker } from './picker.js';
import {
  describeComponent,
  getPublicInstance,
  getHostNode,
  describeElement,
} from './fibers.js';
import { serialize } from '../shared/serialize.js';
import { getIn, setIn } from '../shared/paths.js';
import { showHighlight, hideHighlight } from './overlay.js';

(function main() {
  if (window.__RRI_AGENT__) return;
  window.__RRI_AGENT__ = true;

  let active = false; // a devtools panel is connected
  let lastRoots = [];

  function send(msg) {
    try {
      window.postMessage({ __rri: 'to-panel', msg }, '*');
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
      if (active) scan();
    }, 300);
  }

  const hookState = installReactHook(() => scheduleAutoRescan());
  const registry = createStoreRegistry(send, () => active);
  installReduxShim((store) => registry.register(store, { tier: 1 }));

  // Public API for apps that want guaranteed registration.
  window.__REACT_REDUX_INSPECTOR__ = {
    register: (store, label) => registry.register(store, { tier: 2, label }),
  };

  const components = new Map(); // id -> { comp, node }
  let nextComponentId = 1;

  const picker = createPicker({
    onPick(comp, node) {
      send({ type: 'pick-state', picking: false });
      try {
        const id = String(nextComponentId++);
        components.set(id, { comp, node });
        sendComponent(id);
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
    send({
      type: 'component-selected',
      id,
      dom: entry.node ? describeElement(entry.node) : null,
      ...info,
    });
  }

  function scan() {
    lastRoots = discoverStores(registry, hookState);
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
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.__rri !== 'to-agent') return;
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
