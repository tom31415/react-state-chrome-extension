# React Query Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect `@tanstack/react-query` (v4/v5) `QueryClient` instances on the page, list their queries and mutations live in a new "Queries" panel tab, and support refetch/invalidate/reset/remove actions plus direct data editing — mirroring the existing Redux store support.

**Architecture:** A new `queryRegistry.js` on the page-agent side (parallel to `reduxRegistry.js`, but simpler — no tiers) is populated by a new `discoverQueryClients` in `discovery.js` (fiber-walk for `QueryClientProvider`'s `client` prop + a window-global fallback). It pushes a lightweight, unconditional list of queries/mutations plus on-demand full detail for whichever single item is selected, reusing the existing message-passing/serialize/setIn infrastructure untouched. The panel gets a new "Queries" tab: a flat searchable list (new `queryList.js` module) plus a detail pane that reuses `tree.js` as-is.

**Tech Stack:** Vanilla JS (no framework) Chrome MV3 extension; `node:test` for unit tests; `playwright-core` + a real headless Chromium for e2e; demo app loads `@tanstack/react-query@4.44.0` via its UMD build from unpkg (pinned, with a verified SRI hash) — v5 dropped UMD builds entirely, but v4/v5 share the same cache API this feature depends on, so a v4 demo fully exercises both.

## Global Constraints

- Detect only v4/v5-shaped `QueryClient`s (duck-typed via `getQueryCache`/`getMutationCache`/`invalidateQueries`/`setQueryData`); no v3 special-casing.
- No ephemeral-vs-persistent distinction: every discovered client is edited/actioned through its real public API, always to full effect (unlike Redux's 3 tiers).
- No new npm dependencies: the demo loads React Query via a pinned CDN `<script>` (matching how React/Redux/react-redux are already loaded there), and unit tests use a hand-written fake `QueryClient` stub (matching how `test/registry.test.mjs` fakes a Redux store) — `package.json` is not touched.
- Reuse existing infrastructure untouched: `serialize.js`, `setIn`/`getIn` (`paths.js`), `tree.js`'s `createTree`, the existing `chip`/`.tree-row` CSS classes, and the generic `error` message → toast path for action failures.
- New page-agent messages follow the existing handler-per-type pattern in `src/page-agent/index.js`; any handler that throws is already caught by the existing top-level try/catch and reported via the existing `error` message — new bespoke result messages (`query-action-result`, `query-edit-result`) are added only where a **success** toast is also needed (mirroring `edit-result`).

---

### Task 1: Query registry core (agent-side data layer)

**Files:**
- Modify: `src/page-agent/reduxRegistry.js` (export the existing `throttle` helper)
- Create: `src/page-agent/queryRegistry.js`
- Create: `test/queryRegistry.test.mjs`

**Interfaces:**
- Consumes: `throttle(fn, ms)` from `reduxRegistry.js`; `serialize(value)` from `../shared/serialize.js`; `setIn(obj, path, value)` from `../shared/paths.js`.
- Produces: `isQueryClientLike(o): boolean` and `createQueryRegistry(send, isActive)` returning `{ register(client, label), listQueries(), listMutations(), getQueryDetail(id), getMutationDetail(id), refetchQuery(id), invalidateQuery(id), resetQuery(id), removeQuery(id), removeMutation(id), editQueryData(id, path, value), pushAll() }` — used by Task 2's `index.js` wiring and Task 2's `discovery.js`. Row/detail shapes documented in Task 2/4.

- [ ] **Step 1: Export `throttle` from `reduxRegistry.js`**

In `src/page-agent/reduxRegistry.js`, change:

```js
function throttle(fn, ms) {
```

to:

```js
export function throttle(fn, ms) {
```

- [ ] **Step 2: Run the existing unit suite to confirm this one-word change breaks nothing**

Run: `node --test test/registry.test.mjs`
Expected: all existing tests still PASS (this is a pure export addition, no behavior change).

- [ ] **Step 3: Write the failing tests for `queryRegistry.js`**

Create `test/queryRegistry.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryRegistry, isQueryClientLike } from '../src/page-agent/queryRegistry.js';

function makeQuery(queryKey, overrides = {}) {
  return {
    queryKey,
    queryHash: JSON.stringify(queryKey),
    state: {
      status: 'success',
      fetchStatus: 'idle',
      data: { name: 'ada' },
      error: null,
      dataUpdatedAt: 1000,
      isInvalidated: false,
      ...overrides.state,
    },
    observers: overrides.observers || [{}],
    isStale: () => !!overrides.stale,
  };
}

function makeMutation(mutationId, overrides = {}) {
  return {
    mutationId,
    options: overrides.mutationKey ? { mutationKey: overrides.mutationKey } : {},
    state: {
      status: 'success',
      data: { ok: true },
      error: null,
      variables: { text: 'hi' },
      submittedAt: 2000,
      ...overrides.state,
    },
  };
}

// A fake QueryClient exposing exactly the surface queryRegistry.js uses,
// mirroring how test/registry.test.mjs fakes a plain Redux store instead of
// depending on the real library.
function makeFakeClient({ queries = [], mutations = [] } = {}) {
  const queryListeners = new Set();
  const mutationListeners = new Set();
  const calls = [];
  const queryCache = {
    getAll: () => queries,
    subscribe: (fn) => { queryListeners.add(fn); return () => queryListeners.delete(fn); },
  };
  const mutationCache = {
    getAll: () => mutations,
    subscribe: (fn) => { mutationListeners.add(fn); return () => mutationListeners.delete(fn); },
    remove: (m) => calls.push(['removeMutation', m]),
  };
  const client = {
    getQueryCache: () => queryCache,
    getMutationCache: () => mutationCache,
    invalidateQueries: (f) => calls.push(['invalidateQueries', f]),
    refetchQueries: (f) => calls.push(['refetchQueries', f]),
    resetQueries: (f) => calls.push(['resetQueries', f]),
    removeQueries: (f) => calls.push(['removeQueries', f]),
    setQueryData: (key, value) => calls.push(['setQueryData', key, value]),
  };
  return { client, calls, notifyQuery: () => queryListeners.forEach((f) => f()) };
}

test('isQueryClientLike checks the QueryClient shape', () => {
  const { client } = makeFakeClient();
  assert.ok(isQueryClientLike(client));
  assert.ok(!isQueryClientLike({ getQueryCache() {} }));
  assert.ok(!isQueryClientLike(null));
  assert.ok(!isQueryClientLike('client'));
});

test('register dedupes by client identity and returns the same id', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const { client } = makeFakeClient();
  const id1 = registry.register(client, 'a');
  const id2 = registry.register(client, 'a');
  assert.equal(id1, id2);
});

test('listQueries reports one row per cached query, id-composed as clientId:queryHash', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const q = makeQuery(['user', '1']);
  const { client } = makeFakeClient({ queries: [q] });
  const clientId = registry.register(client, 'demo');
  const rows = registry.listQueries();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, `${clientId}:${q.queryHash}`);
  assert.equal(rows[0].keyDisplay, JSON.stringify(['user', '1']));
  assert.equal(rows[0].status, 'success');
  assert.equal(rows[0].clientLabel, null, 'only one client registered — no label prefix needed');
});

test('listQueries normalizes v4\'s "loading" status to "pending" (v5\'s name for the same state)', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const q = makeQuery(['x'], { state: { status: 'loading' } });
  const { client } = makeFakeClient({ queries: [q] });
  registry.register(client, 'demo');
  assert.equal(registry.listQueries()[0].status, 'pending');
});

test('clientLabel is only populated across multiple registered clients', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const { client: c1 } = makeFakeClient({ queries: [makeQuery(['a'])] });
  const { client: c2 } = makeFakeClient({ queries: [makeQuery(['b'])] });
  registry.register(c1, 'first');
  registry.register(c2, 'second');
  const labels = registry.listQueries().map((r) => r.clientLabel).sort();
  assert.deepEqual(labels, ['first', 'second']);
});

test('listMutations falls back to "Mutation #<id>" when there is no mutationKey', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const m = makeMutation(7);
  const { client } = makeFakeClient({ mutations: [m] });
  registry.register(client, 'demo');
  assert.equal(registry.listMutations()[0].keyDisplay, 'Mutation #7');
});

test('getQueryDetail returns full serialized data and null on an unknown id', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const q = makeQuery(['user', '1']);
  const { client } = makeFakeClient({ queries: [q] });
  const clientId = registry.register(client, 'demo');
  const detail = registry.getQueryDetail(`${clientId}:${q.queryHash}`);
  assert.deepEqual(detail.data, { name: 'ada' });
  assert.equal(detail.error, null);
  assert.equal(registry.getQueryDetail(`${clientId}:nope`), null);
});

test('getMutationDetail includes variables, data, and a plain mutationId for display', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const m = makeMutation(3, { mutationKey: ['addComment'] });
  const { client } = makeFakeClient({ mutations: [m] });
  const clientId = registry.register(client, 'demo');
  const detail = registry.getMutationDetail(`${clientId}:m3`);
  assert.equal(detail.mutationId, 3);
  assert.deepEqual(detail.variables, { text: 'hi' });
  assert.deepEqual(detail.data, { ok: true });
});

test('refetch/invalidate/reset/remove target the exact query (exact: true) via its queryKey', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const q = makeQuery(['user', '1']);
  const { client, calls } = makeFakeClient({ queries: [q] });
  const clientId = registry.register(client, 'demo');
  const id = `${clientId}:${q.queryHash}`;

  registry.refetchQuery(id);
  registry.invalidateQuery(id);
  registry.resetQuery(id);
  registry.removeQuery(id);

  assert.deepEqual(calls, [
    ['refetchQueries', { queryKey: ['user', '1'], exact: true }],
    ['invalidateQueries', { queryKey: ['user', '1'], exact: true }],
    ['resetQueries', { queryKey: ['user', '1'], exact: true }],
    ['removeQueries', { queryKey: ['user', '1'], exact: true }],
  ]);
});

test('an action on an unknown query id throws', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  assert.throws(() => registry.refetchQuery('42:missing'), /Unknown query/);
});

test('removeMutation passes the exact Mutation object reference to the mutation cache', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const m = makeMutation(9);
  const { client, calls } = makeFakeClient({ mutations: [m] });
  const clientId = registry.register(client, 'demo');
  registry.removeMutation(`${clientId}:m9`);
  assert.deepEqual(calls, [['removeMutation', m]]);
});

test('editQueryData sets the full value at a path within the query\'s current data via setQueryData', () => {
  const registry = createQueryRegistry(() => {}, () => false);
  const q = makeQuery(['user', '1']);
  const { client, calls } = makeFakeClient({ queries: [q] });
  const clientId = registry.register(client, 'demo');
  registry.editQueryData(`${clientId}:${q.queryHash}`, ['name'], 'grace');
  assert.deepEqual(calls, [['setQueryData', ['user', '1'], { name: 'grace' }]]);
});

test('registering while a panel is active pushes queries and mutations immediately', () => {
  const sent = [];
  const registry = createQueryRegistry((m) => sent.push(m), () => true);
  registry.register(makeFakeClient({ queries: [makeQuery(['a'])] }).client, 'demo');
  assert.equal(sent.filter((m) => m.type === 'queries').length, 1);
  assert.equal(sent.filter((m) => m.type === 'mutations').length, 1);
});

test('getQueryDetail marks that query as "wanted" so its detail re-pushes on the next cache event', async () => {
  // The cache subscribe callback is wrapped in throttle() (see reduxRegistry.js),
  // which schedules its first call via setTimeout rather than running
  // synchronously — this test must yield to the event loop before asserting.
  const sent = [];
  const registry = createQueryRegistry((m) => sent.push(m), () => true);
  const q = makeQuery(['user', '1']);
  const { client, notifyQuery } = makeFakeClient({ queries: [q] });
  const clientId = registry.register(client, 'demo');
  const id = `${clientId}:${q.queryHash}`;

  registry.getQueryDetail(id);
  sent.length = 0;
  notifyQuery();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(sent.filter((m) => m.type === 'query-detail' && m.id === id).length, 1);
});

test('pushAll pushes nothing while no panel is connected', () => {
  const sent = [];
  let active = false;
  const registry = createQueryRegistry((m) => sent.push(m), () => active);
  registry.register(makeFakeClient({ queries: [makeQuery(['a'])] }).client, 'demo');
  assert.equal(sent.length, 0);
  active = true;
  registry.pushAll();
  assert.ok(sent.some((m) => m.type === 'queries'));
});
```

- [ ] **Step 4: Run the test file to confirm it fails**

Run: `node --test test/queryRegistry.test.mjs`
Expected: FAIL — `Cannot find module '../src/page-agent/queryRegistry.js'`.

- [ ] **Step 5: Implement `src/page-agent/queryRegistry.js`**

```js
// Registry of React Query QueryClient instances found on the page. Unlike
// reduxRegistry.js, there is no ephemeral-vs-persistent distinction: a
// QueryClient is only ever found by direct reference (fiber walk or window
// global — see discovery.js), so every discovered client already exposes
// its full public API, and setQueryData/invalidateQueries/refetchQueries/
// resetQueries/removeQueries always take full effect.

import { serialize } from '../shared/serialize.js';
import { setIn } from '../shared/paths.js';
import { throttle } from './reduxRegistry.js';

export function isQueryClientLike(o) {
  return !!(
    o &&
    typeof o === 'object' &&
    typeof o.getQueryCache === 'function' &&
    typeof o.getMutationCache === 'function' &&
    typeof o.invalidateQueries === 'function' &&
    typeof o.setQueryData === 'function'
  );
}

// v4 uses 'loading' for an in-flight query with no data yet; v5 renamed it
// to 'pending'. Normalize so the panel only ever sees one vocabulary.
function normalizeStatus(status) {
  return status === 'loading' ? 'pending' : status;
}

function queryKeyDisplay(queryKey) {
  try {
    return JSON.stringify(queryKey);
  } catch {
    return String(queryKey);
  }
}

function errorMessage(err) {
  return err ? String((err && err.message) || err) : null;
}

export function createQueryRegistry(send, isActive) {
  const clients = new Map(); // clientId -> { id, client, label }
  const byClient = new WeakMap();
  let nextId = 1;
  let detailWanted = null; // { kind: 'query' | 'mutation', id } | null

  function register(client, label) {
    if (!isQueryClientLike(client)) return null;
    const existingId = byClient.get(client);
    if (existingId !== undefined) return existingId;
    const id = String(nextId++);
    clients.set(id, { id, client, label: label || `QueryClient ${id}` });
    byClient.set(client, id);
    const push = throttle(() => pushAll(), 150);
    client.getQueryCache().subscribe(push);
    client.getMutationCache().subscribe(push);
    if (isActive()) pushAll();
    return id;
  }

  function splitId(id) {
    const i = id.indexOf(':');
    return [id.slice(0, i), id.slice(i + 1)];
  }

  function findQuery(id) {
    const [clientId, hash] = splitId(id);
    const entry = clients.get(clientId);
    if (!entry) return null;
    return entry.client.getQueryCache().getAll().find((q) => q.queryHash === hash) || null;
  }

  function findMutation(id) {
    const [clientId, rest] = splitId(id);
    const entry = clients.get(clientId);
    if (!entry) return null;
    const mutationId = Number(rest.slice(1)); // strip the 'm' prefix
    return entry.client.getMutationCache().getAll().find((m) => m.mutationId === mutationId) || null;
  }

  function clientFor(id) {
    const [clientId] = splitId(id);
    const entry = clients.get(clientId);
    return entry ? entry.client : null;
  }

  function listQueries() {
    const multi = clients.size > 1;
    const rows = [];
    for (const entry of clients.values()) {
      for (const q of entry.client.getQueryCache().getAll()) {
        rows.push({
          id: `${entry.id}:${q.queryHash}`,
          clientLabel: multi ? entry.label : null,
          keyDisplay: queryKeyDisplay(q.queryKey),
          status: normalizeStatus(q.state.status),
          fetchStatus: q.state.fetchStatus,
          isStale: q.isStale(),
          observerCount: q.observers.length,
          dataUpdatedAt: q.state.dataUpdatedAt,
        });
      }
    }
    return rows;
  }

  function listMutations() {
    const multi = clients.size > 1;
    const rows = [];
    for (const entry of clients.values()) {
      for (const m of entry.client.getMutationCache().getAll()) {
        rows.push({
          id: `${entry.id}:m${m.mutationId}`,
          clientLabel: multi ? entry.label : null,
          keyDisplay: m.options.mutationKey ? queryKeyDisplay(m.options.mutationKey) : `Mutation #${m.mutationId}`,
          status: normalizeStatus(m.state.status),
          submittedAt: m.state.submittedAt,
        });
      }
    }
    return rows;
  }

  function buildQueryDetail(id) {
    const q = findQuery(id);
    if (!q) return null;
    return {
      id,
      queryKey: q.queryKey,
      status: normalizeStatus(q.state.status),
      fetchStatus: q.state.fetchStatus,
      isStale: q.isStale(),
      observerCount: q.observers.length,
      dataUpdatedAt: q.state.dataUpdatedAt,
      error: errorMessage(q.state.error),
      data: serialize(q.state.data),
    };
  }

  function buildMutationDetail(id) {
    const m = findMutation(id);
    if (!m) return null;
    return {
      id,
      mutationId: m.mutationId,
      status: normalizeStatus(m.state.status),
      submittedAt: m.state.submittedAt,
      error: errorMessage(m.state.error),
      variables: serialize(m.state.variables),
      data: serialize(m.state.data),
    };
  }

  function pushDetailIfWanted() {
    if (!detailWanted || !isActive()) return;
    if (detailWanted.kind === 'query') {
      const detail = buildQueryDetail(detailWanted.id);
      send(detail ? { type: 'query-detail', ...detail } : { type: 'query-detail', id: detailWanted.id, gone: true });
    } else {
      const detail = buildMutationDetail(detailWanted.id);
      send(
        detail
          ? { type: 'mutation-detail', ...detail }
          : { type: 'mutation-detail', id: detailWanted.id, gone: true }
      );
    }
  }

  function pushAll() {
    if (!isActive()) return;
    send({ type: 'queries', queries: listQueries() });
    send({ type: 'mutations', mutations: listMutations() });
    pushDetailIfWanted();
  }

  function getQueryDetail(id) {
    detailWanted = { kind: 'query', id };
    return buildQueryDetail(id);
  }

  function getMutationDetail(id) {
    detailWanted = { kind: 'mutation', id };
    return buildMutationDetail(id);
  }

  function refetchQuery(id) {
    const q = findQuery(id);
    if (!q) throw new Error(`Unknown query ${id}`);
    clientFor(id).refetchQueries({ queryKey: q.queryKey, exact: true });
  }

  function invalidateQuery(id) {
    const q = findQuery(id);
    if (!q) throw new Error(`Unknown query ${id}`);
    clientFor(id).invalidateQueries({ queryKey: q.queryKey, exact: true });
  }

  function resetQuery(id) {
    const q = findQuery(id);
    if (!q) throw new Error(`Unknown query ${id}`);
    clientFor(id).resetQueries({ queryKey: q.queryKey, exact: true });
  }

  function removeQuery(id) {
    const q = findQuery(id);
    if (!q) throw new Error(`Unknown query ${id}`);
    clientFor(id).removeQueries({ queryKey: q.queryKey, exact: true });
  }

  function removeMutation(id) {
    const m = findMutation(id);
    if (!m) throw new Error(`Unknown mutation ${id}`);
    clientFor(id).getMutationCache().remove(m);
  }

  function editQueryData(id, path, value) {
    const q = findQuery(id);
    if (!q) throw new Error(`Unknown query ${id}`);
    const next = setIn(q.state.data, path, value);
    clientFor(id).setQueryData(q.queryKey, next);
  }

  return {
    register,
    listQueries,
    listMutations,
    getQueryDetail,
    getMutationDetail,
    refetchQuery,
    invalidateQuery,
    resetQuery,
    removeQuery,
    removeMutation,
    editQueryData,
    pushAll,
  };
}
```

- [ ] **Step 6: Run the test file to confirm it passes**

Run: `node --test test/queryRegistry.test.mjs`
Expected: PASS, all 15 tests green.

- [ ] **Step 7: Run the full unit suite to check for regressions**

Run: `npm test`
Expected: PASS, 95 previous + 15 new = 110 tests, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/page-agent/reduxRegistry.js src/page-agent/queryRegistry.js test/queryRegistry.test.mjs
git commit -m "$(cat <<'EOF'
Add React Query registry (page-agent data layer)

Parallel to reduxRegistry.js but simpler: every discovered QueryClient
is found by direct reference, so there's no ephemeral-vs-persistent
tier concept — setQueryData/invalidateQueries/refetchQueries/
resetQueries/removeQueries always take full effect. Not yet wired to
discovery or the message handlers (next task).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Discovery + page-agent wiring

**Files:**
- Modify: `src/page-agent/discovery.js`
- Modify: `src/page-agent/index.js`

**Interfaces:**
- Consumes: `createQueryRegistry`, `isQueryClientLike` from Task 1's `queryRegistry.js`; `collectRoots`, `walkFiberTree`, `walkLegacyTree` (already exported from `discovery.js`/`fibers.js`).
- Produces: `discoverQueryClients(registry, hookState)` (exported from `discovery.js`, called by `index.js`'s `scan()`); page-agent message handlers `get-query-detail`, `get-mutation-detail`, `refetch-query`, `invalidate-query`, `reset-query`, `remove-query`, `remove-mutation`, `edit-query-data` — all consumed by Task 4's panel wiring.

This task has no dedicated unit test: `discoverStores` (the existing, analogous Redux discovery function) has none either, because it calls `collectRoots`, which calls `findReactRootsInDom()` — a function that dereferences the bare global `document` with no existence guard, making it untestable in plain `node:test` without a DOM shim. The existing codebase's convention is to verify this kind of code exclusively via the e2e suite (see `store-detection.e2e.mjs`); Task 4's `react-query.e2e.mjs` is where `discoverQueryClients` gets its real behavioral verification. This task's own verification is therefore a build + full-suite regression check only.

- [ ] **Step 1: Add QueryClient discovery to `discovery.js`**

In `src/page-agent/discovery.js`, add the import and two new exports (leave everything existing untouched):

```js
import { isQueryClientLike } from './queryRegistry.js';
```

(add this line next to the existing `import { isStoreLike } from './reduxRegistry.js';`)

```js
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
```

- [ ] **Step 2: Wire the query registry into `index.js`**

In `src/page-agent/index.js`, update the imports:

```js
import { installReactHook, getRendererVersions } from './reactHook.js';
import { installReduxShim } from './reduxShim.js';
import { createStoreRegistry } from './reduxRegistry.js';
import { createQueryRegistry } from './queryRegistry.js';
import { discoverStores, discoverQueryClients, collectRoots } from './discovery.js';
```

Right after `const registry = createStoreRegistry(send, () => active);`, add:

```js
  const queryRegistry = createQueryRegistry(send, () => active);
```

Update `scan()`:

```js
  function scan() {
    lastRoots = discoverStores(registry, hookState);
    discoverQueryClients(queryRegistry, hookState);
  }
```

Update `fullSync()`:

```js
  function fullSync() {
    scan();
    sendEnvironment();
    send({ type: 'stores', stores: registry.list() });
    registry.pushAll();
    queryRegistry.pushAll();
    if (wantsComponentTree) sendComponentTree();
  }
```

Add a small ack helper next to the `handlers` object (above it), and the new handlers inside `handlers`:

```js
  function ackQueryAction(action, fn) {
    try {
      fn();
      send({ type: 'query-action-result', action, ok: true });
    } catch (err) {
      send({ type: 'query-action-result', action, ok: false, error: String((err && err.message) || err) });
    }
  }
```

Add these entries to the existing `handlers` object (alongside the current `'get-store-history'`, `'jump-to-action'`, etc. — same object, just more keys):

```js
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
```

- [ ] **Step 3: Build and confirm no errors**

Run: `npm run build`
Expected: esbuild reports success for all 5 entry points, no errors.

- [ ] **Step 4: Run the full unit suite to check for regressions**

Run: `npm test`
Expected: PASS, 110 tests, 0 fail (this task adds no new unit tests — see rationale above).

- [ ] **Step 5: Commit**

```bash
git add src/page-agent/discovery.js src/page-agent/index.js
git commit -m "$(cat <<'EOF'
Wire React Query discovery and message handlers into the page agent

discoverQueryClients mirrors discoverStores: fiber-walk for
QueryClientProvider's client prop, plus a window-global fallback. No
dedicated unit test, matching discoverStores's own untested status —
both depend on findReactRootsInDom's bare `document` reference and are
verified via the e2e suite instead (Task 4).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Panel query list module

**Files:**
- Create: `src/devtools/panel/queryList.js`
- Create: `test/queryList.test.mjs`

**Interfaces:**
- Consumes: nothing project-specific (pure DOM + plain data).
- Produces: `matchesQuery(row, query): boolean`, `deriveBadge(row): 'error'|'fetching'|'stale'|'fresh'`, `createQueryList(container, opts)` returning `{ setData(rows), setQuery(text), setSelected(id) }` where `opts = { onSelect(id), emptyMessage }` — consumed by Task 4's `panel.js`. Row shape (from Task 1): `{ id, clientLabel, keyDisplay, status, fetchStatus, isStale, observerCount, dataUpdatedAt }` for queries, `{ id, clientLabel, keyDisplay, status, submittedAt }` for mutations — `deriveBadge` only reads `status`, `fetchStatus`, `isStale`, all present on query rows; mutation rows lack `fetchStatus`/`isStale` (both `undefined`), which `deriveBadge` treats as "not fetching, not stale" — i.e. mutation rows always badge as `'fresh'` unless `status === 'error'`.

- [ ] **Step 1: Write the failing tests for the pure functions**

Create `test/queryList.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery, deriveBadge } from '../src/devtools/panel/queryList.js';

test('matchesQuery matches on keyDisplay, case-insensitively', () => {
  const row = { keyDisplay: '["user","1"]', clientLabel: null };
  assert.ok(matchesQuery(row, ''));
  assert.ok(matchesQuery(row, 'USER'));
  assert.ok(!matchesQuery(row, 'todo'));
});

test('matchesQuery also matches on clientLabel when present', () => {
  const row = { keyDisplay: '["a"]', clientLabel: 'Admin client' };
  assert.ok(matchesQuery(row, 'admin'));
});

test('deriveBadge: error status always wins', () => {
  assert.equal(deriveBadge({ status: 'error', fetchStatus: 'fetching', isStale: true }), 'error');
});

test('deriveBadge: fetchStatus fetching or status pending means "fetching"', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'fetching', isStale: false }), 'fetching');
  assert.equal(deriveBadge({ status: 'pending', fetchStatus: 'idle', isStale: false }), 'fetching');
});

test('deriveBadge: stale beats fresh when not fetching or errored', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'idle', isStale: true }), 'stale');
});

test('deriveBadge: fresh is the default', () => {
  assert.equal(deriveBadge({ status: 'success', fetchStatus: 'idle', isStale: false }), 'fresh');
});

test('deriveBadge: a mutation row (no fetchStatus/isStale) badges fresh unless errored', () => {
  assert.equal(deriveBadge({ status: 'success' }), 'fresh');
  assert.equal(deriveBadge({ status: 'error' }), 'error');
});
```

- [ ] **Step 2: Run the test file to confirm it fails**

Run: `node --test test/queryList.test.mjs`
Expected: FAIL — `Cannot find module '../src/devtools/panel/queryList.js'`.

- [ ] **Step 3: Implement `src/devtools/panel/queryList.js`**

```js
// Renders the flat list of queries or mutations sent by the agent as
// searchable rows with status badges — no nesting (unlike componentTree.js),
// since each query/mutation is an independent cache entry, not a tree.
// Search matching and badge derivation are pure functions so they're
// unit-testable without a DOM, mirroring componentTree.js's
// computeSearchVisibility.

export function matchesQuery(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.keyDisplay.toLowerCase().includes(q) || (row.clientLabel || '').toLowerCase().includes(q);
}

// One badge per row: 'error' beats 'fetching' beats 'stale' beats 'fresh'.
// 'fetching' also covers a first-ever load (status 'pending' means no data
// has ever arrived yet). Mutation rows carry no fetchStatus/isStale (both
// undefined), so they always land on 'fresh' unless status is 'error'.
export function deriveBadge(row) {
  if (row.status === 'error') return 'error';
  if (row.fetchStatus === 'fetching' || row.status === 'pending') return 'fetching';
  if (row.isStale) return 'stale';
  return 'fresh';
}

const BADGE_CLASS = { error: 'chip-err', fetching: 'chip-warn', stale: 'chip-warn', fresh: 'chip-ok' };

export function createQueryList(container, opts = {}) {
  let rows = [];
  let query = '';
  let selectedId = null;

  function setData(next) {
    rows = next;
    render();
  }

  function setQuery(next) {
    query = next;
    render();
  }

  function setSelected(id) {
    selectedId = id;
    render();
  }

  function render() {
    // A full teardown-and-rebuild collapses the container to empty (however
    // briefly) before its content grows back — preserve scrollTop explicitly
    // (try/finally: several branches below return early), matching tree.js
    // and componentTree.js.
    const scrollTop = container.scrollTop;
    try {
      container.textContent = '';
      if (rows.length === 0) {
        container.appendChild(emptyState(opts.emptyMessage || 'Nothing here yet.'));
        return;
      }
      const visible = rows.filter((r) => matchesQuery(r, query));
      if (visible.length === 0) {
        container.appendChild(emptyState(`No matches for "${query}".`));
        return;
      }
      const frag = document.createDocumentFragment();
      for (const row of visible) frag.appendChild(renderRow(row));
      container.appendChild(frag);
    } finally {
      container.scrollTop = scrollTop;
    }
  }

  function renderRow(row) {
    const el = document.createElement('div');
    el.className = 'query-row' + (row.id === selectedId ? ' selected' : '');

    const kind = deriveBadge(row);
    const badge = document.createElement('span');
    badge.className = `chip ${BADGE_CLASS[kind]}`;
    badge.textContent = kind;
    el.appendChild(badge);

    if (row.clientLabel) {
      const clientEl = document.createElement('span');
      clientEl.className = 'query-client';
      clientEl.textContent = `[${row.clientLabel}]`;
      el.appendChild(clientEl);
    }

    const key = document.createElement('span');
    key.className = 'query-key';
    key.textContent = row.keyDisplay;
    el.appendChild(key);

    el.addEventListener('click', () => opts.onSelect && opts.onSelect(row.id));
    return el;
  }

  return { setData, setQuery, setSelected };
}

function emptyState(text) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  return empty;
}
```

- [ ] **Step 4: Run the test file to confirm it passes**

Run: `node --test test/queryList.test.mjs`
Expected: PASS, all 7 tests green.

- [ ] **Step 5: Run the full unit suite to check for regressions**

Run: `npm test`
Expected: PASS, 110 previous + 7 new = 117 tests, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/devtools/panel/queryList.js test/queryList.test.mjs
git commit -m "$(cat <<'EOF'
Add panel-side query/mutation list renderer

Flat searchable rows with status badges (error/fetching/stale/fresh),
matchesQuery and deriveBadge kept pure and unit-tested (mirroring
tree.js/componentTree.js's DOM-free search/classify helpers). Not yet
wired into panel.js (next task).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Panel UI wiring, demo app, and end-to-end tests

**Files:**
- Modify: `src/devtools/panel/panel.html`
- Modify: `src/devtools/panel/panel.css`
- Modify: `src/devtools/panel/panel.js`
- Modify: `demo/index.html`
- Modify: `demo/agent-test.html`
- Modify: `demo/app.js`
- Create: `e2e/react-query.e2e.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createQueryList` from Task 3; the `queries`/`mutations`/`query-detail`/`mutation-detail`/`query-action-result`/`query-edit-result` messages and `get-query-detail`/`get-mutation-detail`/`refetch-query`/`invalidate-query`/`reset-query`/`remove-query`/`remove-mutation`/`edit-query-data` message types from Task 2; `createTree` from the existing `tree.js`.
- Produces: nothing further downstream — this is the last task.

This task has no unit test of its own (panel.js has none in this codebase — `ls test/` confirms no `panel.test.mjs` exists; DOM wiring here is exclusively verified via the e2e suite, same as every other panel feature this project has shipped). Its test cycle is the new `e2e/react-query.e2e.mjs` file, run against a real build in real headless Chromium.

- [ ] **Step 1: Add the "Queries" tab and view to `panel.html`**

In `src/devtools/panel/panel.html`, change the nav:

```html
      <nav>
        <button id="tab-stores" class="tab active">Stores</button>
        <button id="tab-component" class="tab">Component</button>
        <button id="tab-queries" class="tab">Queries</button>
      </nav>
```

Add a new `<section>` right after the existing `#component-view` section (still inside `<main>`, before `</main>`):

```html
      <section id="queries-view" hidden>
        <aside id="query-list-pane">
          <div id="query-list-toolbar">
            <input id="query-search" type="search" placeholder="Search queries…" />
            <div class="pill-toggle">
              <button id="query-kind-queries" class="pill active">Queries</button>
              <button id="query-kind-mutations" class="pill">Mutations</button>
            </div>
          </div>
          <div id="query-list"></div>
        </aside>
        <div id="query-detail"></div>
      </section>
```

- [ ] **Step 2: Add CSS for the new tab in `panel.css`**

Append to `src/devtools/panel/panel.css`:

```css
.chip-err { color: var(--err); border-color: var(--err); }

#queries-view { display: flex; }
#query-list-pane {
  width: 260px;
  min-width: 180px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
#query-list-toolbar { display: flex; flex-direction: column; border-bottom: 1px solid var(--border); }
#query-search {
  font: inherit;
  color: var(--fg);
  background: var(--bg);
  border: none;
  padding: 6px 8px;
  outline: none;
}
#query-search:focus { background: color-mix(in srgb, var(--accent) 6%, transparent); }
.pill-toggle { display: flex; }
.pill { flex: 1; border-radius: 0; border: none; border-top: 1px solid var(--border); font-size: 11px; }
#query-list {
  flex: 1;
  overflow: auto;
  padding: 4px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}
.query-row { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; border-radius: 3px; }
.query-row:hover { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.query-row.selected { background: color-mix(in srgb, var(--accent) 18%, transparent); outline: 1px solid var(--accent); outline-offset: -1px; }
.query-client { color: var(--dim); font-size: 10px; white-space: nowrap; }
.query-key { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }

#query-detail { flex: 1; overflow: auto; padding: 10px 14px; }
.query-actions { display: flex; gap: 6px; margin: 8px 0; }
```

- [ ] **Step 3: Wire `panel.js`**

Add the import at the top:

```js
import { createQueryList } from './queryList.js';
```

Add fields to the `state` object (alongside the existing `historyPaneOpen`/`storeHistories`):

```js
  queries: [],
  mutations: [],
  queryKind: 'queries', // 'queries' | 'mutations'
  selectedQueryId: null,
  queryDetail: null, // full detail payload for selectedQueryId, or null
  queryDetailGone: false,
```

In the `agent-ready` case of `onPortMessage` (the big reset block), add resets right after the existing `renderStoreHistory();` line and before `sendToAgent({ type: 'init' });`:

```js
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
```

Add new cases to the `onPortMessage` switch, right after the existing `case 'error':` block's closing (still inside the switch, before the final `}`):

```js
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
```

Add this module-level constant near the top (after the `state` object):

```js
const ACTION_LABELS = {
  refetch: 'Refetched',
  invalidate: 'Invalidated',
  reset: 'Reset',
  remove: 'Removed',
  'remove-mutation': 'Removed',
};
```

Add the `queryList` instance next to the existing `storeTree`/`componentTree` instantiations:

```js
const queryList = createQueryList($('#query-list'), {
  emptyMessage: 'No queries found yet. If the app creates its QueryClient before scanning, hit Rescan.',
  onSelect(id) {
    selectQueryRow(id);
  },
});
```

Add these new functions (anywhere among the other render functions, e.g. right after `renderComponentFocusBar`):

```js
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
  view.textContent = '';
  const d = state.queryDetail;
  if (!d) {
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

  const header = document.createElement('div');
  header.className = 'component-header';
  const title = document.createElement('h2');
  title.textContent = state.queryKind === 'queries' ? JSON.stringify(d.queryKey) : `Mutation #${d.mutationId}`;
  header.appendChild(title);
  header.appendChild(chip(d.status, d.status === 'error' ? 'chip-err' : d.status === 'success' ? 'chip-ok' : 'chip-warn'));
  if (state.queryKind === 'queries') header.appendChild(chip(d.fetchStatus, 'chip-dim'));
  view.appendChild(header);

  if (d.error) {
    const err = document.createElement('div');
    err.className = 'component-meta';
    err.textContent = `Error: ${d.error}`;
    view.appendChild(err);
  }

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

  addSection(view, state.queryKind === 'queries' ? 'Data (editable)' : 'Data', (pane) => {
    createTree(pane, {
      rootLabel: 'data',
      onEdit:
        state.queryKind === 'queries'
          ? (path, json) => sendToAgent({ type: 'edit-query-data', id: d.id, path, json })
          : undefined,
      onToast: toast,
    }).setData(d.data);
  });

  if (state.queryKind === 'mutations' && d.variables !== undefined) {
    addSection(view, 'Variables', (pane) => {
      createTree(pane, { rootLabel: 'variables' }).setData(d.variables);
    });
  }
}

function actionButton(label, onClick) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
```

Update `renderAll()` to also render the new views:

```js
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
```

Update `renderTabs()` to show/hide the new section and toggle the new tab button:

```js
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
```

Add event listeners at the bottom, next to the existing `$('#tab-component')` listener:

```js
$('#tab-queries').addEventListener('click', () => {
  state.tab = 'queries';
  renderTabs();
});
$('#query-kind-queries').addEventListener('click', () => setQueryKind('queries'));
$('#query-kind-mutations').addEventListener('click', () => setQueryKind('mutations'));
$('#query-search').addEventListener('input', (e) => queryList.setQuery(e.target.value));
```

- [ ] **Step 4: Build and smoke-check by hand**

Run: `npm run build`
Expected: esbuild reports success, no errors.

Run: `npm test`
Expected: PASS, 117 tests, 0 fail (no new unit tests in this step — DOM wiring is e2e-only, per this task's header note).

- [ ] **Step 5: Add React Query to the demo app**

Compute (already done and verified during planning): pin `@tanstack/react-query@4.44.0`'s UMD production build — v5 dropped UMD builds entirely, but v4/v5 expose the same `getQueryCache`/`getMutationCache`/etc. surface this feature depends on. Its global is `ReactQuery`, and its SRI hash (`sha384-t+m5ipCzPIH91KFo2L/QRcy++vHmD0d/Ii2M9pP3eaIhIRnsBQtU5sEnxyvkXUHH`) was verified by downloading the file twice from `https://unpkg.com/@tanstack/react-query@4.44.0/build/umd/index.production.js` and confirming an identical `openssl dgst -sha384` both times.

In `demo/index.html`, add this script tag right after the existing `react-redux` script tag:

```html
    <script crossorigin="anonymous" integrity="sha384-t+m5ipCzPIH91KFo2L/QRcy++vHmD0d/Ii2M9pP3eaIhIRnsBQtU5sEnxyvkXUHH" src="https://unpkg.com/@tanstack/react-query@4.44.0/build/umd/index.production.js"></script>
```

In `demo/agent-test.html`, add the identical script tag in the identical position (right after its `react-redux` script tag).

In `demo/index.html`'s description paragraph, add a sentence: change

```html
    <p>
      Load the extension (dist/ unpacked), open DevTools → “React+Redux”. Store “counter”
      is created through the devtools enhancer (tier 1, persistent edits); store “todos”
      is only discoverable through its react-redux Provider (tier 3, ephemeral edits).
    </p>
```

to:

```html
    <p>
      Load the extension (dist/ unpacked), open DevTools → “React+Redux”. Store “counter”
      is created through the devtools enhancer (tier 1, persistent edits); store “todos”
      is only discoverable through its react-redux Provider (tier 3, ephemeral edits).
      The Queries tab shows a React Query QueryClient with one query (switchable between
      two users) and one mutation.
    </p>
```

- [ ] **Step 6: Add a QueryClient, a query, and a mutation to `demo/app.js`**

In `demo/app.js`, add right after the existing `const ThemeContext = React.createContext('light');` line:

```js
  const queryClient = new ReactQuery.QueryClient();

  function fakeFetchUser(id) {
    return new Promise((resolve) => {
      setTimeout(() => resolve({ id, name: id === '1' ? 'Ada Lovelace' : 'Grace Hopper' }), 150);
    });
  }

  function UserQuery() {
    const [userId, setUserId] = React.useState('1');
    const query = ReactQuery.useQuery({
      queryKey: ['user', userId],
      queryFn: () => fakeFetchUser(userId),
    });
    return e('section', { id: 'user-query' },
      e('h2', null, 'UserQuery (React Query)'),
      e('p', null, `status: ${query.status} — ${query.data ? query.data.name : '(no data yet)'}`),
      e('button', { onClick: () => setUserId(userId === '1' ? '2' : '1') }, 'Switch user')
    );
  }

  function AddCommentMutation() {
    const mutation = ReactQuery.useMutation({
      mutationFn: (text) => new Promise((resolve) => setTimeout(() => resolve({ text }), 100)),
    });
    return e('section', { id: 'comment-mutation' },
      e('h2', null, 'AddCommentMutation (React Query)'),
      e('p', null, `status: ${mutation.status}`),
      e('button', { onClick: () => mutation.mutate('a demo comment') }, 'Submit comment')
    );
  }
```

Update the `App` function to mount both inside a `QueryClientProvider`:

```js
  function App() {
    return e(React.Fragment, null,
      e(ClassCounter, { label: 'class component, local state' }),
      e(ReactRedux.Provider, { store: counterStore }, e(HookCounter, { label: 'hooks + react-redux' })),
      e(ReactRedux.Provider, { store: todoStore }, e(TodoList)),
      e(ThemeContext.Provider, { value: 'dark' }, e(ThemedBadge)),
      e(ReactQuery.QueryClientProvider, { client: queryClient },
        e(React.Fragment, null, e(UserQuery), e(AddCommentMutation))
      )
    );
  }
```

- [ ] **Step 7: Write the e2e test file**

Create `e2e/react-query.e2e.mjs`:

```js
// Regression coverage for React Query support: detection via
// QueryClientProvider's client prop, the live queries/mutations list,
// per-item detail with data editing, and the four query actions
// (Refetch/Invalidate/Reset/Remove) plus mutation Remove.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, treeRowTexts, clickRowContaining } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
  await session.panelPage.click('#tab-queries');
  await session.settle();
});

after(async () => {
  await session.close();
});

test('the demo QueryClient is detected and its query is listed', async () => {
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.ok(
    rows.some((r) => r.includes('user') && r.includes('"1"')),
    `expected a user query row, got: ${JSON.stringify(rows)}`
  );
});

test('the query is no longer "fetching" once the fake fetch has resolved', async () => {
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  const userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh|stale/, `expected a settled badge, got: ${userRow}`);
});

test('selecting the query shows its data in the detail pane', async () => {
  await clickRowContaining(session.panelPage, '.query-row', '"1"');
  await session.settle();
  const dataText = await session.panelPage.evaluate(() => document.querySelector('#query-detail')?.innerText || '');
  assert.match(dataText, /Ada Lovelace/);
});

test('editing the query data persists and is reflected by the running app', async () => {
  const rows = await session.panelPage.$$('#query-detail .tree-row');
  let row = null;
  for (const r of rows) {
    if ((await r.innerText()).includes('name')) {
      row = r;
      break;
    }
  }
  await row.dblclick();
  await session.panelPage.waitForTimeout(80);
  const input = await session.panelPage.$('input.tree-edit');
  await input.fill('"Edited Name"');
  await input.press('Enter');
  await session.settle();
  const appText = await session.appPage.evaluate(() => document.querySelector('#user-query p').textContent);
  assert.match(appText, /Edited Name/);
});

test('Refetch overwrites the local edit once the fake fetch resolves again', async () => {
  await session.panelPage.click('#query-detail button:has-text("Refetch")');
  await session.panelPage.waitForTimeout(250); // longer than the demo's fake 150ms latency
  await session.settle();
  const appText = await session.appPage.evaluate(() => document.querySelector('#user-query p').textContent);
  assert.match(appText, /Ada Lovelace/, "the real queryFn's result wins back over the edit");
});

test('Reset returns the query to a fresh, refetched state', async () => {
  await session.panelPage.click('#query-detail button:has-text("Reset")');
  await session.panelPage.waitForTimeout(250);
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  const userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh/);
});

test('Invalidate triggers an immediate refetch (transient fetching), then resolves back to fresh', async () => {
  await session.panelPage.click('#query-detail button:has-text("Invalidate")');
  await session.settle(2, 40); // short window: before the demo's 150ms fake latency resolves
  let rows = await treeRowTexts(session.panelPage, '.query-row');
  let userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fetching/, 'invalidating an active query triggers an immediate refetch');

  await session.panelPage.waitForTimeout(250);
  await session.settle();
  rows = await treeRowTexts(session.panelPage, '.query-row');
  userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh/);
});

test('switching to a second user creates a second query row', async () => {
  await session.appPage.click('#user-query button:has-text("Switch user")');
  await session.panelPage.waitForTimeout(250);
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.filter((r) => r.includes('user')).length, 2, `expected 2 user query rows, got: ${JSON.stringify(rows)}`);
});

test('Remove deletes the query row from the list', async () => {
  await clickRowContaining(session.panelPage, '.query-row', '"2"');
  await session.settle();
  await session.panelPage.click('#query-detail button:has-text("Remove")');
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.filter((r) => r.includes('"2"')).length, 0);
});

test('firing a mutation lists it under the Mutations toggle, and Remove clears it', async () => {
  await session.panelPage.click('#query-kind-mutations');
  await session.appPage.click('#comment-mutation button:has-text("Submit comment")');
  await session.panelPage.waitForTimeout(200);
  await session.settle();
  let rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.ok(rows.some((r) => r.includes('Mutation #')), `expected a mutation row, got: ${JSON.stringify(rows)}`);

  await clickRowContaining(session.panelPage, '.query-row', 'Mutation');
  await session.settle();
  await session.panelPage.click('#query-detail button:has-text("Remove")');
  await session.settle();
  rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.length, 0);
});
```

- [ ] **Step 8: Build and run the new e2e file in isolation**

Run: `npm run build && node --test e2e/react-query.e2e.mjs`
Expected: PASS, all 10 tests green. If any timing-sensitive test (the Invalidate transient-fetching check) flakes, widen its `session.settle(2, 40)` window slightly (e.g. `session.settle(3, 40)`) rather than removing the assertion — it must still stay comfortably under the demo's 150ms fake latency.

- [ ] **Step 9: Run the full e2e suite together**

Run: `npm run test:e2e`
Expected: PASS, 39 previous + 10 new = 49 tests, 0 fail.

- [ ] **Step 10: Update `README.md`**

Add a new bullet to the feature list near the top (after the existing "Visual component picker" bullet):

```markdown
- **React Query support**: detects `@tanstack/react-query` (v4/v5) `QueryClient` instances,
  lists their queries and mutations live, and lets you inspect data, edit it, and
  refetch/invalidate/reset/remove individual queries.
```

Add a new subsection right after the existing "## How store discovery works" section (before "## Development"):

```markdown
## How React Query support works

`QueryClientProvider`'s `client` prop is found the same way react-redux's `Provider` store
is (a fiber-tree walk), plus a window-global fallback (`window.queryClient`, etc.) — React
Query has no enhancer-style interception point the way Redux DevTools does, so there's no
"tier 1" equivalent. That also means every discovered client already exposes its full public
API: unlike Redux, there's no ephemeral-vs-persistent split — edits and actions
(Refetch/Invalidate/Reset/Remove) always take full, real effect.
```

- [ ] **Step 11: Final full regression pass**

Run: `npm run test:all`
Expected: PASS, 117 unit + 49 e2e = 166 tests, 0 fail.

- [ ] **Step 12: Commit**

```bash
git add src/devtools/panel/panel.html src/devtools/panel/panel.css src/devtools/panel/panel.js \
  demo/index.html demo/agent-test.html demo/app.js e2e/react-query.e2e.mjs README.md
git commit -m "$(cat <<'EOF'
Add React Query support: Queries tab, demo app, and e2e coverage

New "Queries" tab lists queries/mutations live (status badges, search),
with a detail pane reusing tree.js for data display/editing plus
Refetch/Invalidate/Reset/Remove actions. Demo app gets a QueryClient
with one switchable query and one mutation (react-query@4.44.0 via a
pinned, SRI-verified CDN script — v5 dropped UMD builds, but v4/v5
share the cache API this feature depends on). 10 new e2e tests cover
detection, live status transitions, data editing, and every action.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
