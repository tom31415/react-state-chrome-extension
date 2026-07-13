# Component Tree "Focus" Scoping — Design

**Date:** 2026-07-10
**Status:** Approved for implementation

## Goal

`buildComponentTree` caps at 5000 composite nodes across the whole page; past that, the
truncation note tells the user to "inspect a subtree directly" — a capability that didn't
actually exist. Add a real one: let the user scope the tree walk to a specific component and
its descendants, so the cap applies within that subtree (where a huge app's *feature* is very
unlikely to hit 5000 nodes even if the whole app does).

## What "Focus" does

A small "Focus" button appears on each tree row on hover. Clicking it re-walks the tree
starting **at that component** (shown as the new top-level node) instead of every mounted root.
A one-line bar above the tree — "Focused on `<Name>`  [Show full tree]" — replaces the normal
state when focus is active; clicking "Show full tree" returns to the full walk.

Deliberately **not** a multi-level breadcrumb (`App > Dashboard > Widget`): the agent only walks
*downward* from the focus point, so it has no record of the ancestor chain to show one
correctly, and reconstructing it would need extra bookkeeping this doesn't need — "Focused on
X" plus a clear button fully solves the truncation problem this exists for.

Search keeps working exactly as before, just scoped to whatever the current walk covers (full
tree or focused subtree) — `computeSearchVisibility` doesn't change at all.

## Protocol

`get-component-tree` (panel → agent) gains an optional `focusId`: a component id to scope to,
`null` to clear back to the full tree, or the key omitted entirely to rebuild with whatever
focus is *already* set (used by the tab-switch and throttled auto-rescan paths, which don't
know or care about focus state).

`component-tree` (agent → panel) gains `focusId`, echoing the current state back — including
`null` if the focused component turned out to be gone (see below) — so the panel's "Focused on"
bar stays correct across a background auto-refresh without the panel tracking any of its own
state that could drift from the agent's.

## Agent-side implementation

`buildComponentTree(roots, registerComponent, focusRef)` (`src/page-agent/fibers.js`): when
`focusRef` (a `{kind, ref}` comp) is given, the returned forest is a single top-level node *for
that component itself* (via the same node-building logic already used for ordinary discovery)
with its descendants walked exactly as before; `roots` is ignored in that case.

`src/page-agent/index.js` tracks `componentTreeFocusId` next to the existing
`wantsComponentTree`/`lastTreeIds`. Two existing mechanisms need to also cover the focus id, not
just the selected id, or focus silently breaks on the very next rebuild:

- **Eviction protection**: `sendComponentTree()`'s per-rebuild eviction currently only spares
  `selectedComponentId`. It must also spare `componentTreeFocusId`, or the focused component's
  registration is deleted before the rebuild even looks it up.
- **Id reuse**: `registerComponent()`'s existing reuse check (added for the pick-highlights-tree
  feature) only compares against `selectedComponentId`. It must also try `componentTreeFocusId`,
  or the focus target gets a *new* id on every rebuild, breaking "stay focused across the
  throttled auto-refresh" immediately.

If the focus target's entry is gone when a rebuild runs, `componentTreeFocusId` resets to
`null` (falls back to the full tree) rather than erroring — same "best-effort, no elaborate
liveness tracking" posture as the rest of this codebase.

## Testing

- Unit tests (`fibers.test.mjs`): `buildComponentTree` with a `focusRef` returns a single-root
  forest for that component and its descendants only, ignoring `roots` and everything outside
  the focus subtree, for both fiber and legacy trees.
- Real-browser verification (Playwright, as used throughout this project): focus a component
  via the row button, confirm the tree shows only that subtree and the "Focused on" bar appears;
  confirm search still filters within the focused subtree; confirm "Show full tree" restores
  the complete tree; confirm the throttled auto-refresh keeps the same subtree focused rather
  than reverting to the full tree or erroring.
