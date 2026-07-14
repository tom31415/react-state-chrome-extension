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
