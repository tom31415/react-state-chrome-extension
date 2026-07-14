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
