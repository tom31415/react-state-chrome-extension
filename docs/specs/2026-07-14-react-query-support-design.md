# React Query Support — Design

**Date:** 2026-07-14
**Status:** Approved for implementation

## Goal

Extend the extension beyond React + Redux to also detect and inspect
[`@tanstack/react-query`](https://tanstack.com/query) (v4/v5) `QueryClient` instances: list
queries and mutations from the cache, view their live status and data, and support the same
kind of live editing/actions the Stores tab offers for Redux — refetch, invalidate, reset,
remove, and direct data editing.

Older `react-query` v3 (pre-rename) is not specially supported; its cache shape differs enough
that it's out of scope for v1.

## Detection

No interception point exists for React Query the way `__REDUX_DEVTOOLS_EXTENSION__` lets the
Redux support shim an enhancer before the app runs — a `QueryClient` is always constructed by
app code with no hook to catch at that moment. Detection is therefore fiber-walk + window-global
only, exactly the tier-3 "discovered" path Redux already has:

- **`QueryClientProvider` prop** — its `client` prop holds the `QueryClient` instance, found the
  same way `discovery.js`'s `checkCandidates` already finds react-redux's `props.store`.
- **Window globals** — a small list of common names (`window.queryClient`, etc.), mirroring
  `WINDOW_STORE_NAMES`.

`isQueryClientLike(o)` duck-types via `typeof o.getQueryCache === 'function' && typeof
o.getMutationCache === 'function' && typeof o.invalidateQueries === 'function' && typeof
o.setQueryData === 'function'` — present on v4 and v5, not specifically checked against v3.

**Consequence of this detection path:** because the *only* way a client is ever found is by
reference to the real, live `QueryClient`, every discovered client already exposes its full
public API. Unlike Redux there is no ephemeral-vs-persistent distinction to track —edits and
actions always go through `setQueryData`/`invalidateQueries`/`refetchQueries`/
`resetQueries`/`removeQueries` directly and always take full effect.

## Registry

New `src/page-agent/queryRegistry.js`, structurally parallel to `reduxRegistry.js` but simpler
(no tiers, no override bookkeeping):

- `register(client, label)` — dedupes by client identity (a `WeakMap`, same idea as
  `reduxRegistry`'s `byStore`), subscribes to `client.getQueryCache().subscribe(...)` and
  `client.getMutationCache().subscribe(...)`, each throttled at 150ms (same constant Redux uses)
  before pushing an updated list.
- **List pushes are lightweight and unconditional**: `queries` / `mutations` messages carry only
  `{ id, queryHash or mutationId, clientLabel, keyDisplay, status, fetchStatus, isStale,
  observerCount, dataUpdatedAt }` — no serialized data. This avoids broadcasting potentially
  large payloads for every query on every cache event when only one item is likely selected at a
  time.
- **Detail pushed on demand only**, mirroring the existing `wantsComponentTree`/`historyWanted`
  pattern: the panel asks for a specific query/mutation's full state (`get-query-detail` /
  `get-mutation-detail`), the agent replies once and keeps re-pushing that one item's detail
  (`query-detail` / `mutation-detail`) as it changes, until the panel asks for a different one or
  navigates away. Data reuses `serialize.js` unmodified.
- **Actions** (queries): `refetch-query`, `invalidate-query`, `reset-query`, `remove-query` —
  each resolves the target via `client.getQueryCache().getAll().find(q => q.queryHash ===
  hash)`, then calls the matching `QueryClient` method scoped to that exact query.
- **Actions** (mutations): `remove-mutation` only — mutations have no refetch/invalidate concept;
  `client.getMutationCache().remove(mutation)`.
- **Edit**: `edit-query-data` — `setIn` (reused from `src/shared/paths.js`, same helper Redux
  editing uses) computes the new value at a path within the query's current data, then
  `client.setQueryData(queryKey, next)` applies it. Always succeeds; no persistent/ephemeral
  split to report back (contrast with Redux's `edit()` return value).

## Panel UI

`panel.html` gains a third top-level tab, "Queries", next to Stores and Component — a flat list
doesn't fit naturally inside the existing Stores tab's single-tree-per-store model, so it gets
its own space rather than being folded in.

- **Aside**: a search box (filters by key, reusing the existing tree-search text-matching
  approach) and a Queries/Mutations pill toggle above a flat, scrollable row list. Each row shows
  a status badge (fresh / stale / fetching / error, derived from `status` + `fetchStatus` +
  `isInvalidated`) and the key display (`JSON.stringify(queryKey)` truncated, or the mutation's
  `mutationKey`/description). If more than one `QueryClient` is discovered, each row is prefixed
  with its client's label instead of introducing a separate client-selector level — kept flat
  deliberately, matching the "Focus" design's earlier call to avoid unnecessary nesting.
- **Detail pane**: reuses `tree.js` for the selected item's data (so search, copy-value, and
  copy-path all come for free, no new code), plus a small stats block (status, fetch status,
  `dataUpdatedAt`, observer count for queries; `submittedAt`, variables for mutations) and action
  buttons (Refetch / Invalidate / Reset / Remove for queries; Remove for mutations).
- Selecting a row sends the corresponding `get-query-detail`/`get-mutation-detail` request;
  switching tabs away stops that subscription the same way switching away from a store already
  works today (no explicit "unwant" message needed — the panel simply stops asking).

## Testing

- **Unit** (`test/queryRegistry.test.mjs`, new): registration/dedupe by client identity, list
  shape and throttling, `edit-query-data`'s path-based update, each action calling the expected
  `QueryClient` method with the resolved query/mutation.
- **Demo app**: `demo/app.js` gets a `QueryClientProvider` wrapping a small component that runs
  one `useQuery` (a fake, delayed fetch so status transitions are observable) and one
  `useMutation`, giving e2e tests real fetching/success/error states to exercise.
- **E2E** (`e2e/react-query.e2e.mjs`, new): client detected and listed, query status updates live
  as the fake fetch resolves, selecting a query shows its data in the detail pane, editing a
  field persists and is reflected by the running app, Refetch/Invalidate/Reset/Remove each have
  the expected observable effect, mutation appears after firing and Remove clears it — mirroring
  the structure of `store-detection.e2e.mjs` and `props-editing.e2e.mjs`.
