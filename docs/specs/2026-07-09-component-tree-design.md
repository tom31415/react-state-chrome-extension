# Component Tree View + Search — Design

**Date:** 2026-07-09
**Status:** Approved for implementation

## Goal

The Component tab currently only supports selecting a component by visually clicking it on the
page (the "Element selector" picker). Add a browsable tree of all mounted components plus a
search bar, so a component can also be found and selected without hunting for it on screen.

## Scope decision (confirmed with the user)

The tree shows **composite components only** (function/class/memo/forwardRef) — not host DOM
elements. Host elements have nothing this extension can inspect (no props/state/hooks), and
this matches the picker's existing "nearest composite" behavior. `Context.Provider`, `Fragment`,
and other non-composite fibers are transparently flattened through: their composite descendants
attach directly to the nearest composite ancestor.

## Discovery: `buildComponentTree(roots)`

New function in `src/page-agent/fibers.js`, using the same walkers already used for store
discovery (`walkFiberTree` for 16+, `walkLegacyTree` for 15). For each mounted root, it recurses
depth-first; on a composite fiber it emits `{ id, name, kind, key, children: [] }` and recurses
into that fiber's children to find nested composites, and on a non-composite fiber it recurses
without emitting, keeping discovered composites attached to the current (nearest composite or
root) parent. Every discovered composite is registered into the agent's existing `components`
id → `{comp, node}` map (`src/page-agent/index.js`) — the same map the picker already populates
— so selecting a tree node is just `sendComponent(id)`, reusing all existing detail/edit/
highlight machinery with no new per-component fetch logic.

Capped at 5000 composite nodes total (across all roots); if exceeded, the returned payload sets
`truncated: true` and `total` so the panel can show a visible note rather than silently cutting
off.

## Message protocol additions

- Panel → agent: `get-component-tree` (request a fresh build), `select-component { id }`
  (equivalent to what happens after a pick — calls `sendComponent(id)`).
- Agent → panel: `component-tree { roots: [...], truncated, total }`.

## Live updates

The existing throttled (300ms) auto-rescan — added for store discovery — is extended to also
rebuild and push the component tree, but only once the panel has sent `get-component-tree` at
least once (avoids the cost of walking the tree when the user is on the Stores tab). The tree
is also rebuilt on an explicit `Rescan` click and whenever the panel first switches to the
Component tab.

## Panel UI

The Component tab becomes a two-pane layout, matching the Stores tab's existing pattern:

- **Left:** a search input above a scrollable tree. Rows show the component name and a small
  kind badge; click selects (single click, not double — there's no value to edit here). A twisty
  expands/collapses children. Expand state is keyed by **structural path** (index chain from
  root), the same approach `tree.js` already uses for state/props trees — this survives a tree
  rebuild as long as structure doesn't drastically reorder, without needing fiber-identity
  stability across rescans (fibers are re-created on every commit; paths are far more stable).
- **Right:** the existing component detail view (header, props, state, hooks), unchanged —
  populated by `component-selected`, whether it arrived via the tree or via the picker.
- **Search** filters to nodes whose name matches (case-insensitive substring) OR that have a
  matching descendant, auto-expanding ancestors of matches; clearing the search restores the
  prior expand/collapse state.

The "⌖ Element selector" picker is unchanged and coexists with the tree as a second, independent
way to reach the same detail view.

## Explicit scope cut

Picking a component visually does **not** auto-scroll-to/highlight the corresponding tree row in
this version. Fiber identity isn't stable across rescans, so reliably matching "the node I just
picked" to "a row in the last tree snapshot" is nontrivial; the two selection paths are
independent for now. Can be revisited if it turns out to matter in practice.

## Error handling

- No composite components found: a friendly empty state in the tree pane, same tone as the
  existing "no stores found" message, pointing at Rescan.
- A tree node's id going stale between build and click (component unmounted in between): reuses
  `sendComponent`'s existing "Component reference is gone" error, shown as a toast.

## Testing

- Unit tests (`node --test`) for `buildComponentTree`: composite-only filtering, correct
  nesting across host/Fragment/Provider gaps, key/kind extraction, and the 5000-node cap +
  `truncated` flag, using mock fibers in the same style as the existing `fibers.test.mjs`.
- A pure, unit-testable search-filter function (given a tree + query, returns which node paths
  survive and which are force-expanded) independent of the DOM, mirroring how `tree.js`'s
  `classify`/`reconstruct` are already tested without a DOM.
- Real-browser verification (Playwright, as used throughout this project) against the demo app:
  confirm the tree shows exactly `ClassCounter`, `HookCounter`, `TodoList` under `App`, with
  `Fragment`/`Provider` correctly flattened through; confirm clicking a tree row shows the same
  detail view as picking the same component visually; confirm search filtering and live
  refresh (mount/unmount a component) work end to end.
