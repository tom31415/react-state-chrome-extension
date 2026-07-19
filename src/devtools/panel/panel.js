// DevTools panel UI: Stores tab (live state trees with editing) and
// Component tab (visually picked component details).

import { createTree } from './tree.js';
import { createComponentTree } from './componentTree.js';
import { createQueryList } from './queryList.js';
import { TAG, isTagged } from '../../shared/serialize.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  env: null,
  stores: [],
  storeStates: new Map(), // id -> serialized state node
  component: null,
  selectedStoreId: null,
  picking: false,
  highlightUpdates: false,
  tab: 'stores',
  componentTree: { roots: [], truncated: false, total: 0, focusId: null },
  componentTreeRequested: false,
  historyPaneOpen: false,
  storeHistories: new Map(), // id -> { entries: [{seq, type}], total }
  queries: [],
  mutations: [],
  queryKind: 'queries', // 'queries' | 'mutations'
  selectedQueryId: null,
  queryDetail: null, // full detail payload for selectedQueryId, or null
  queryDetailGone: false,
};

const ACTION_LABELS = {
  refetch: 'Refetched',
  invalidate: 'Invalidated',
  reset: 'Reset',
  remove: 'Removed',
  'remove-mutation': 'Removed',
};

// A page/service-worker reconnect (see the 'agent-ready' case below) clears
// storeStates and briefly shows "Waiting for state…", which collapses
// #store-tree to one line — any scrollTop we try to set at that instant is
// clamped straight back to 0, since there's nothing to scroll into yet. The
// captured value has to survive across that gap and get applied only once
// the real state is back and the tree has its real height again.
let pendingScrollRestore = null; // { storeId, scrollTop } | null

// ---------- connection ----------
// The MV3 service worker is terminated when idle, which kills the port; the
// panel must reconnect and re-register or it is permanently deaf.

let port = null;

function connect() {
  port = chrome.runtime.connect({ name: 'rsi-panel' });
  port.postMessage({ type: 'panel-init', tabId: chrome.devtools.inspectedWindow.tabId });
  port.onMessage.addListener(onPortMessage);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // read to silence "Unchecked runtime.lastError"
    port = null;
    setTimeout(() => {
      connect();
      sendToAgent({ type: 'init' });
    }, 100);
  });
}

function sendToAgent(msg) {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch {
    port = null;
  }
}

function onPortMessage(msg) {
  switch (msg.type) {
    case 'bridge-ready':
      // Sent by content.js whenever ITS OWN port to the service worker
      // reconnects — the MV3 service worker idle-suspends routinely
      // (roughly every ~30s of inactivity), entirely independent of the
      // page or its stores. The page's agent is untouched by this (same
      // registry, same everything) — just ask it to re-sync. Clearing the
      // UI first (as this used to share with 'agent-ready' below) forced a
      // guaranteed empty-then-repopulate flash on every idle-suspend cycle
      // even though nothing had actually changed.
      sendToAgent({ type: 'init' });
      break;
    case 'agent-ready':
      // Sent by the page agent itself only on a genuinely fresh instance
      // (a real navigation/reload, or a bfcache restore) — the previous
      // agent, and everything it knew, really is gone, so a full reset here
      // is correct.
      // Capture BEFORE anything is cleared/re-rendered — #store-tree still
      // shows the real, fully-scrolled tree at this exact point.
      if (state.selectedStoreId != null) {
        pendingScrollRestore = { storeId: state.selectedStoreId, scrollTop: $('#store-tree').scrollTop };
      }
      state.stores = [];
      state.storeStates.clear();
      state.component = null;
      state.picking = false;
      state.highlightUpdates = false;
      renderHighlightUpdatesButton();
      state.componentTree = { roots: [], truncated: false, total: 0, focusId: null };
      state.componentTreeRequested = false;
      $('#component-search').value = '';
      componentTree.setQuery('');
      componentTree.setData(state.componentTree);
      componentTree.setSelected(null);
      renderComponentFocusBar();
      $('#store-search').value = '';
      storeTree.setQuery('');
      state.historyPaneOpen = false;
      state.storeHistories.clear();
      renderStoreHistory();
      state.queries = [];
      state.mutations = [];
      state.queryKind = 'queries';
      state.selectedQueryId = null;
      state.queryDetail = null;
      state.queryDetailGone = false;
      $('#query-search').value = '';
      queryList.setQuery('');
      queryList.setData([]);
      queryList.setSelected(null);
      $('#query-kind-queries').classList.add('active');
      $('#query-kind-mutations').classList.remove('active');
      renderQueryDetail();
      sendToAgent({ type: 'init' });
      renderAll();
      break;
    case 'environment':
      state.env = msg;
      renderEnv();
      break;
    case 'stores':
      state.stores = msg.stores;
      if (!state.stores.some((s) => s.id === state.selectedStoreId)) {
        state.selectedStoreId = state.stores.length ? state.stores[0].id : null;
        if (state.historyPaneOpen) requestStoreHistory(state.selectedStoreId);
      }
      renderStores();
      renderEnv();
      break;
    case 'store-state':
      state.storeStates.set(msg.storeId, msg.state);
      if (msg.storeId === state.selectedStoreId) renderStoreTree();
      break;
    case 'slice':
      mergeSlice(msg.storeId, msg.path, msg.node);
      break;
    case 'store-history':
      state.storeHistories.set(msg.storeId, { entries: msg.entries, total: msg.total });
      if (msg.storeId === state.selectedStoreId) renderStoreHistory();
      break;
    case 'store-action': {
      const existing = state.storeHistories.get(msg.storeId) || { entries: [], total: 0 };
      const entries = [...existing.entries, { seq: msg.seq, type: msg.actionType }];
      if (entries.length > 50) entries.shift(); // mirrors the agent's own MAX_HISTORY cap
      state.storeHistories.set(msg.storeId, { entries, total: msg.total });
      if (msg.storeId === state.selectedStoreId) renderStoreHistory();
      break;
    }
    case 'edit-result':
      if (!msg.ok) toast(`Edit failed: ${msg.error}`, 'error');
      else if (msg.mode === 'ephemeral')
        toast(
          'Edited (ephemeral — reverts on the next dispatched action; apps on react-redux v8+ may not repaint until their next render).',
          'warn'
        );
      else toast('State updated.', 'ok');
      break;
    case 'pick-state':
      state.picking = msg.picking;
      if (msg.reason) toast(msg.reason, 'warn');
      renderPickButton();
      break;
    case 'component-selected':
      state.component = msg;
      state.tab = 'component';
      renderAll();
      componentTree.setSelected(msg.id);
      break;
    case 'component-tree':
      state.componentTree = {
        roots: msg.roots,
        truncated: msg.truncated,
        total: msg.total,
        focusId: msg.focusId,
      };
      componentTree.setData(state.componentTree);
      renderComponentFocusBar();
      break;
    case 'error':
      toast(msg.message, 'error');
      break;
    case 'queries':
      state.queries = msg.queries;
      renderQueryList();
      break;
    case 'mutations':
      state.mutations = msg.mutations;
      renderQueryList();
      break;
    case 'query-detail':
    case 'mutation-detail':
      if (msg.id === state.selectedQueryId) {
        state.queryDetail = msg.gone ? null : msg;
        state.queryDetailGone = !!msg.gone;
        renderQueryDetail();
      }
      break;
    case 'query-action-result':
      if (!msg.ok) toast(`Action failed: ${msg.error}`, 'error');
      else toast(`${ACTION_LABELS[msg.action] || 'Done'}.`, 'ok');
      break;
    case 'query-edit-result':
      if (!msg.ok) toast(`Edit failed: ${msg.error}`, 'error');
      else toast('Query data updated.', 'ok');
      break;
  }
}

connect();
sendToAgent({ type: 'init' });

// ---------- trees ----------

const storeTree = createTree($('#store-tree'), {
  rootLabel: 'state',
  onEdit(path, json) {
    sendToAgent({ type: 'edit-state', storeId: state.selectedStoreId, path, json });
  },
  onLoadDepth(path) {
    sendToAgent({ type: 'get-slice', storeId: state.selectedStoreId, path });
  },
  onToast: toast,
});

const componentTree = createComponentTree($('#component-tree'), {
  onSelect(id) {
    sendToAgent({ type: 'select-component', id });
  },
  onHover(id) {
    if (id) sendToAgent({ type: 'highlight-component', id });
    else sendToAgent({ type: 'clear-highlight' });
  },
  onFocus(id) {
    sendToAgent({ type: 'get-component-tree', focusId: id });
  },
});

const queryList = createQueryList($('#query-list'), {
  emptyMessage: 'No queries found yet. If the app creates its QueryClient before scanning, hit Rescan.',
  onSelect(id) {
    selectQueryRow(id);
  },
});

// The Queries tab's detail pane follows the same create-once,
// update-via-setData discipline as storeTree above: a structural rebuild
// (header shell, action buttons, tree instance creation) only happens when
// the selected item's IDENTITY changes (new selection, or switching
// Queries<->Mutations) — tracked by queryDetailKey. Same-identity pushes
// (every throttled cache event while a query is fetching, or after
// Refetch/Invalidate/etc.) update the existing tree(s) via setData, exactly
// like storeTree.setData() does, instead of tearing down and losing
// expansion state, scroll position, and any in-flight edit input.
let queryDetailKey = null; // `${kind}:${id}` of what's currently built, or null
let queryDetailTree = null; // primary Data/Variables-adjacent tree instance
let queryDetailVariablesTree = null; // mutations' extra "Variables" tree instance, when present

function renderComponentFocusBar() {
  const bar = $('#component-focus-bar');
  const focusId = state.componentTree.focusId;
  bar.hidden = focusId == null;
  if (focusId != null) {
    const name = state.componentTree.roots[0]?.name || 'component';
    $('#component-focus-label').textContent = `Focused on <${name}>`;
  }
}

function renderQueryList() {
  queryList.setData(state.queryKind === 'queries' ? state.queries : state.mutations);
}

function selectQueryRow(id) {
  state.selectedQueryId = id;
  state.queryDetail = null;
  state.queryDetailGone = false;
  queryList.setSelected(id);
  renderQueryDetail();
  sendToAgent({
    type: state.queryKind === 'queries' ? 'get-query-detail' : 'get-mutation-detail',
    id,
  });
}

function setQueryKind(kind) {
  if (state.queryKind === kind) return;
  state.queryKind = kind;
  state.selectedQueryId = null;
  state.queryDetail = null;
  state.queryDetailGone = false;
  $('#query-kind-queries').classList.toggle('active', kind === 'queries');
  $('#query-kind-mutations').classList.toggle('active', kind === 'mutations');
  queryList.setSelected(null);
  renderQueryList();
  renderQueryDetail();
}

function renderQueryDetail() {
  const view = $('#query-detail');
  const d = state.queryDetail;

  if (!d) {
    // Nothing to update in place (no selection, still loading, or the
    // entry is gone) — reset identity so the NEXT real detail rebuilds
    // fresh rather than trying to update a pane with no tree in it.
    queryDetailKey = null;
    queryDetailTree = null;
    queryDetailVariablesTree = null;
    view.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = state.queryDetailGone
      ? 'This entry is no longer in the cache.'
      : state.selectedQueryId
        ? 'Loading…'
        : `Select a ${state.queryKind === 'queries' ? 'query' : 'mutation'} to inspect it.`;
    view.appendChild(empty);
    return;
  }

  const key = `${state.queryKind}:${d.id}`;
  if (key !== queryDetailKey) {
    // Identity changed (new selection, or switched Queries<->Mutations):
    // full structural rebuild, including fresh tree instance(s).
    queryDetailKey = key;
    view.textContent = '';

    const header = document.createElement('div');
    header.className = 'component-header';
    header.id = 'query-detail-header';
    view.appendChild(header);

    const errBox = document.createElement('div');
    errBox.className = 'component-meta';
    errBox.id = 'query-detail-error';
    errBox.hidden = true;
    view.appendChild(errBox);

    const actions = document.createElement('div');
    actions.className = 'query-actions';
    if (state.queryKind === 'queries') {
      actions.appendChild(actionButton('Refetch', () => sendToAgent({ type: 'refetch-query', id: d.id })));
      actions.appendChild(actionButton('Invalidate', () => sendToAgent({ type: 'invalidate-query', id: d.id })));
      actions.appendChild(actionButton('Reset', () => sendToAgent({ type: 'reset-query', id: d.id })));
      actions.appendChild(actionButton('Remove', () => sendToAgent({ type: 'remove-query', id: d.id })));
    } else {
      actions.appendChild(actionButton('Remove', () => sendToAgent({ type: 'remove-mutation', id: d.id })));
    }
    view.appendChild(actions);

    queryDetailTree = null;
    addSection(view, state.queryKind === 'queries' ? 'Data (editable)' : 'Data', (pane) => {
      queryDetailTree = createTree(pane, {
        rootLabel: 'data',
        onEdit:
          state.queryKind === 'queries'
            ? (path, json) => sendToAgent({ type: 'edit-query-data', id: d.id, path, json })
            : undefined,
        onToast: toast,
      });
    });

    queryDetailVariablesTree = null;
    if (state.queryKind === 'mutations' && d.variables !== undefined) {
      addSection(view, 'Variables', (pane) => {
        queryDetailVariablesTree = createTree(pane, { rootLabel: 'variables' });
      });
    }
  }

  // Same identity as last time (or just built fresh above): update
  // status/error/data in place. The header is small and fully stateless
  // (no scroll/expansion state lives in it) so a cheap full re-render of
  // just that sub-tree is fine; the tree(s) below use setData so their
  // expansion state and #query-detail's scroll position survive, exactly
  // like storeTree.setData() already does for the Stores tab.
  const header = $('#query-detail-header');
  header.textContent = '';
  const title = document.createElement('h2');
  title.textContent = state.queryKind === 'queries' ? JSON.stringify(d.queryKey) : `Mutation #${d.mutationId}`;
  header.appendChild(title);
  header.appendChild(chip(d.status, d.status === 'error' ? 'chip-err' : d.status === 'success' ? 'chip-ok' : 'chip-warn'));
  if (state.queryKind === 'queries') header.appendChild(chip(d.fetchStatus, 'chip-dim'));

  const errBox = $('#query-detail-error');
  errBox.hidden = !d.error;
  errBox.textContent = d.error ? `Error: ${d.error}` : '';

  queryDetailTree.setData(d.data);
  if (queryDetailVariablesTree) queryDetailVariablesTree.setData(d.variables);
}

function actionButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function mergeSlice(storeId, path, replacement) {
  const current = state.storeStates.get(storeId);
  if (current === undefined) return;
  state.storeStates.set(storeId, setSerialized(current, path, replacement));
  if (storeId === state.selectedStoreId) renderStoreTree();
}

// Replace the node at a REAL state path inside a serialized tree.
function setSerialized(node, path, replacement) {
  if (path.length === 0) return replacement;
  const [k, ...rest] = path;
  if (Array.isArray(node)) {
    const copy = node.slice();
    copy[Number(k)] = setSerialized(node[Number(k)], rest, replacement);
    return copy;
  }
  if (isTagged(node)) {
    if (node[TAG] === 'obj') {
      return { ...node, v: { ...node.v, [k]: setSerialized(node.v[k], rest, replacement) } };
    }
    return node;
  }
  if (node && typeof node === 'object') {
    return { ...node, [k]: setSerialized(node[k], rest, replacement) };
  }
  return node;
}

// ---------- rendering ----------

function renderAll() {
  renderEnv();
  renderTabs();
  renderStores();
  renderComponent();
  renderPickButton();
  renderHighlightUpdatesButton();
  renderComponentFocusBar();
  renderStoreHistory();
  renderQueryList();
  renderQueryDetail();
}

function renderEnv() {
  const env = state.env;
  const box = $('#env');
  box.textContent = '';
  if (!env) return;
  if (env.reactDetected) {
    const versions = env.reactVersions.length ? env.reactVersions.join(', ') : 'detected';
    box.appendChild(chip(`React ${versions}`, 'chip-ok'));
  } else {
    box.appendChild(chip('React not detected', 'chip-warn'));
  }
  box.appendChild(chip(`${state.stores.length} store${state.stores.length === 1 ? '' : 's'}`));
  if (env.hookMode === 'external') {
    box.appendChild(chip('React DevTools hook active', 'chip-dim'));
  }
}

function chip(text, cls = '') {
  const s = document.createElement('span');
  s.className = `chip ${cls}`;
  s.textContent = text;
  return s;
}

function renderTabs() {
  $('#tab-stores').classList.toggle('active', state.tab === 'stores');
  $('#tab-component').classList.toggle('active', state.tab === 'component');
  $('#tab-queries').classList.toggle('active', state.tab === 'queries');
  $('#stores-view').hidden = state.tab !== 'stores';
  $('#component-view').hidden = state.tab !== 'component';
  $('#queries-view').hidden = state.tab !== 'queries';
  if (state.tab === 'component' && !state.componentTreeRequested) {
    state.componentTreeRequested = true;
    sendToAgent({ type: 'get-component-tree' });
  }
}

function renderStores() {
  const list = $('#store-list');
  list.textContent = '';
  if (state.stores.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      'No Redux stores found. If the app creates its store before scanning, hit Rescan. Apps can also call window.__REACT_STATE_INSPECTOR__.register(store).';
    list.appendChild(empty);
  }
  for (const store of state.stores) {
    const item = document.createElement('button');
    item.className = 'store-item' + (store.id === state.selectedStoreId ? ' selected' : '');
    const name = document.createElement('span');
    name.textContent = `#${store.id} ${store.label}`;
    item.appendChild(name);
    item.appendChild(
      chip(store.tier === 1 ? 'full edit' : 'ephemeral edit', store.tier === 1 ? 'chip-ok' : 'chip-warn')
    );
    item.addEventListener('click', () => selectStore(store.id));
    list.appendChild(item);
  }
  renderStoreTree();
}

function selectStore(id) {
  if (id === state.selectedStoreId) return;
  state.selectedStoreId = id;
  renderStores();
  if (state.historyPaneOpen) requestStoreHistory(id);
  else renderStoreHistory();
}

function requestStoreHistory(id) {
  if (id == null) return;
  sendToAgent({ type: 'get-store-history', storeId: id });
}

function renderStoreHistory() {
  const pane = $('#store-history-pane');
  pane.hidden = !state.historyPaneOpen;
  if (!state.historyPaneOpen) return;
  const list = $('#store-history-list');
  list.textContent = '';
  const id = state.selectedStoreId;
  const history = id == null ? null : state.storeHistories.get(id);
  if (!history || history.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = id == null ? 'No store selected.' : 'No actions recorded yet.';
    list.appendChild(empty);
    return;
  }
  if (history.total > history.entries.length) {
    const note = document.createElement('div');
    note.className = 'tree-note';
    note.textContent = `Showing the last ${history.entries.length} of ${history.total} actions.`;
    list.appendChild(note);
  }
  for (const entry of history.entries) {
    const row = document.createElement('div');
    row.className = 'history-row';
    row.title = 'Jump to this state';
    const seq = document.createElement('span');
    seq.className = 'history-seq';
    seq.textContent = `#${entry.seq}`;
    const type = document.createElement('span');
    type.className = 'history-type';
    type.textContent = entry.type;
    row.appendChild(seq);
    row.appendChild(type);
    row.addEventListener('click', () =>
      sendToAgent({ type: 'jump-to-action', storeId: id, seq: entry.seq })
    );
    list.appendChild(row);
  }
}

function renderStoreTree() {
  const pane = $('#store-tree');
  const id = state.selectedStoreId;
  if (id == null) {
    pane.textContent = '';
    return;
  }
  const data = state.storeStates.get(id);
  if (data === undefined) {
    // This fires every time the extension's own MV3 port reconnects (the
    // service worker idle-suspends periodically, unrelated to the page or
    // the store), not just on a genuine store change. The container has no
    // overflow while this one-line text is showing, so there is no scroll
    // position to preserve HERE — pendingScrollRestore (captured before this
    // branch ever ran) is what survives across this gap and gets applied
    // below once the real state is back.
    pane.textContent = 'Waiting for state…';
    return;
  }
  storeTree.setData(data);
  if (pendingScrollRestore && pendingScrollRestore.storeId === id) {
    pane.scrollTop = pendingScrollRestore.scrollTop;
    pendingScrollRestore = null;
  }
}

function renderComponent() {
  const view = $('#component-detail');
  view.textContent = '';
  const c = state.component;
  if (!c) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent =
      'No component selected. Click "Element selector", then hover the page — elements highlight like the Chrome inspector — and click one to inspect its React component.';
    view.appendChild(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'component-header';
  const title = document.createElement('h2');
  title.textContent = `<${c.name}>`;
  header.appendChild(title);
  header.appendChild(chip(c.kind));
  header.appendChild(chip(c.reactKind === 'legacy' ? 'React 15' : 'Fiber (16+)', 'chip-dim'));
  if (c.dom) header.appendChild(chip(c.dom, 'chip-dim'));
  header.addEventListener('mouseenter', () =>
    sendToAgent({ type: 'highlight-component', id: c.id })
  );
  header.addEventListener('mouseleave', () => sendToAgent({ type: 'clear-highlight' }));
  view.appendChild(header);

  const meta = document.createElement('div');
  meta.className = 'component-meta';
  const metaBits = [];
  if (c.key != null) metaBits.push(`key: ${c.key}`);
  if (c.ownerName) metaBits.push(`rendered by <${c.ownerName}>`);
  if (c.source) metaBits.push(c.source);
  meta.textContent = metaBits.join('  ·  ');
  view.appendChild(meta);

  addSection(view, c.canEditProps ? 'Props (editable)' : 'Props', (pane) => {
    createTree(pane, {
      rootLabel: 'props',
      onEdit: c.canEditProps
        ? (path, json) => sendToAgent({ type: 'set-component-props', id: c.id, path, json })
        : undefined,
      onToast: toast,
    }).setData(c.props);
  });

  if (c.state !== null) {
    addSection(
      view,
      c.canEditState ? 'State (editable)' : 'State',
      (pane) => {
        createTree(pane, {
          rootLabel: 'state',
          onEdit: c.canEditState
            ? (path, json) =>
                sendToAgent({ type: 'set-component-state', id: c.id, path, json })
            : undefined,
          onToast: toast,
        }).setData(c.state);
      }
    );
  }

  if (c.hooks && c.hooks.length) {
    addSection(view, 'Hooks', (pane) => {
      const synthetic = {};
      for (const h of c.hooks) {
        const label = `${h.index} · ${h.kind}`;
        synthetic[label] = h.value === null ? { [TAG]: 'opaque', v: `(${h.kind})` } : h.value;
      }
      createTree(pane, { rootLabel: 'hooks' }).setData(synthetic);
    });
  }

  if (c.context && c.context.length) {
    addSection(view, 'Context', (pane) => {
      const synthetic = {};
      for (const ctx of c.context) synthetic[ctx.name] = ctx.value;
      createTree(pane, { rootLabel: 'context' }).setData(synthetic);
    });
  }
}

function addSection(parent, name, fill) {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = name;
  section.appendChild(h);
  const pane = document.createElement('div');
  pane.className = 'tree-pane';
  section.appendChild(pane);
  parent.appendChild(section);
  fill(pane);
}

function renderPickButton() {
  const btn = $('#pick');
  btn.classList.toggle('active', state.picking);
  btn.textContent = state.picking
    ? '⌖ Selecting… (click an element, Esc to cancel)'
    : '⌖ Element selector';
}

function renderHighlightUpdatesButton() {
  $('#highlight-updates').classList.toggle('active', state.highlightUpdates);
}

// ---------- toasts ----------

function toast(message, kind = 'ok') {
  const box = document.createElement('div');
  box.className = `toast toast-${kind}`;
  box.textContent = message;
  $('#toasts').appendChild(box);
  setTimeout(() => box.remove(), 4500);
}

// ---------- controls ----------

$('#rescan').addEventListener('click', () => sendToAgent({ type: 'rescan' }));
$('#pick').addEventListener('click', () => {
  sendToAgent({ type: state.picking ? 'stop-pick' : 'start-pick' });
});
$('#highlight-updates').addEventListener('click', () => {
  state.highlightUpdates = !state.highlightUpdates;
  renderHighlightUpdatesButton();
  sendToAgent({ type: 'set-highlight-updates', enabled: state.highlightUpdates });
});
$('#store-history-toggle').addEventListener('click', () => {
  state.historyPaneOpen = !state.historyPaneOpen;
  $('#store-history-toggle').classList.toggle('active', state.historyPaneOpen);
  if (state.historyPaneOpen) requestStoreHistory(state.selectedStoreId);
  renderStoreHistory();
});
$('#store-history-clear').addEventListener('click', () => {
  if (state.selectedStoreId != null) sendToAgent({ type: 'clear-store-history', storeId: state.selectedStoreId });
});
$('#tab-stores').addEventListener('click', () => {
  state.tab = 'stores';
  renderTabs();
});
$('#tab-component').addEventListener('click', () => {
  state.tab = 'component';
  renderTabs();
});
$('#tab-queries').addEventListener('click', () => {
  state.tab = 'queries';
  renderTabs();
});
$('#query-kind-queries').addEventListener('click', () => setQueryKind('queries'));
$('#query-kind-mutations').addEventListener('click', () => setQueryKind('mutations'));
$('#query-search').addEventListener('input', (e) => queryList.setQuery(e.target.value));
$('#component-search').addEventListener('input', (e) => componentTree.setQuery(e.target.value));
$('#store-search').addEventListener('input', (e) => storeTree.setQuery(e.target.value));
$('#component-focus-clear').addEventListener('click', () =>
  sendToAgent({ type: 'get-component-tree', focusId: null })
);

renderAll();
