# React + Redux Inspector — Chrome Extension Design

**Date:** 2026-07-08
**Status:** Implemented (designed in an autonomous session; assumptions listed below)

## Goal

A Chrome extension (Manifest V3) for debugging React applications (v15 and newer) that:

1. Detects React on the inspected page and reports the version(s).
2. Lists all registered Redux stores and shows the current state of each, updating live.
3. Lets the user edit store state properties live from the DevTools panel.
4. Provides a visual DOM inspector: pick an element in the page, the extension identifies
   the owning React component and shows its name, kind, props, state, and hooks.

## Assumptions (made autonomously)

- Delivered as a **DevTools panel** (like React/Redux DevTools), not a popup — that is the
  natural surface for this kind of tool.
- **No framework in the panel UI** — vanilla JS/CSS keeps the extension dependency-free;
  the only dev dependency is `esbuild` for bundling.
- "Edit store properties live" means path-based edits of state values (primitives and
  JSON-entered values). Two fidelity tiers, described below, because Redux does not expose
  the reducer on a created store.
- Class component state can also be edited (via `instance.setState`); hooks are read-only.
- New standalone repo `react-redux-inspector`; no remote configured yet.

## Architecture

Chrome MV3 has four isolated contexts. Data flows across all of them:

```
DevTools panel  <-- port -->  Service worker  <-- port -->  Content script  <-- window.postMessage -->  Page agent
 (panel.js)                   (background)                  (ISOLATED world)                            (MAIN world)
```

- **Page agent** (`src/page-agent/`) — injected via `content_scripts` with `"world": "MAIN"`
  at `document_start`. It is the only part with access to page JS (React internals, stores).
- **Content bridge** (`src/content/`) — ISOLATED world, relays messages between the page
  agent (`window.postMessage`) and the service worker (`chrome.runtime.connect`).
- **Service worker** (`src/background/`) — routes messages between DevTools panels and
  content scripts, keyed by `tabId`.
- **DevTools panel** (`src/devtools/`) — registers a "React+Redux" panel; UI has a
  *Stores* tab and a *Component* tab.

## React detection (v15 → v19)

Two complementary strategies, both handled **by object shape rather than version number**:

1. **DevTools global hook.** At `document_start`, if `window.__REACT_DEVTOOLS_GLOBAL_HOOK__`
   is absent, the agent installs a minimal hook (`inject`, `onCommitFiberRoot`,
   `supportsFiber: true`, no-op `on/sub/checkDCE`). React 15+ calls `inject(renderer)`
   (giving us the version) and React 16+ calls `onCommitFiberRoot(root)` on every commit
   (giving us live roots and a change signal). If the real React DevTools hook is already
   present, we leave it alone and rely on strategy 2.
2. **DOM key scan** (fallback and for React 15): scan elements for
   `__reactContainer$*` (18+ roots), `__reactFiber$*` (17+), and
   `__reactInternalInstance$*` (15/16). A fiber is recognized by `.tag`/`.return`;
   a v15 internal instance by `._currentElement`.

## Component identification (visual picker)

- Panel sends `start-pick`; the agent overlays a highlight box (pointer-events: none) and
  captures `mousemove`/`click`/`Escape` at the window level.
- On hover: `event.target` → nearest React-owned DOM node → nearest **composite** component
  (fiber: walk `.return` past host fibers; v15: follow `_currentElement._owner` chain).
  The box and a name label track the hovered node.
- On click: extract component info —
  - **Fiber (16+):** name from `type.displayName|name` (unwrapping memo/forwardRef),
    kind (function/class/memo/forwardRef), `memoizedProps`, class `memoizedState`, and for
    function components the hooks list by walking the `memoizedState` linked list.
  - **v15:** composite internal instance `_currentElement` (type → name, props) and
    `_instance` (public instance → `state`).
- Selected components are kept in an id → ref map so the panel can re-highlight them and
  edit class state via `setState`.

## Redux store registry (three discovery tiers)

| Tier | How | Edit fidelity |
|------|-----|---------------|
| 1 — enhancer | Agent shims `__REDUX_DEVTOOLS_EXTENSION__` / `__REDUX_DEVTOOLS_EXTENSION_COMPOSE__` at `document_start` (chaining to the real Redux DevTools if present). The enhancer wraps the reducer (and `replaceReducer`) to honor a `@@RRI/OVERRIDE_STATE` action. | **Persistent** — the override becomes the store's real state; later actions reduce from it. |
| 2 — explicit | Apps may call `window.__REACT_REDUX_INSPECTOR__.register(store, label)`. | Ephemeral (as tier 3). |
| 3 — discovered | Walk React trees for `react-redux` Providers: `props.store` or context `value.store` with `getState/dispatch/subscribe` shape; also common `window.store`-style globals. | **Ephemeral** — `getState` is patched to return the edited state and subscribers are notified via a no-op dispatch; the next real action clears the override. The UI labels this clearly. |

State pushes to the panel are subscription-driven and throttled (~150 ms), serialized with
depth/size caps, and gated on a panel actually being connected.

## Serialization & editing

- `serialize(value)` produces a JSON-safe tree; non-JSON values become tagged nodes
  (`{"@rri":"fn"|"undef"|"num"|"date"|"map"|"set"|"error"|"element"|"depth"|"circular"|...}`).
  Depth cap 8, 100 keys / 100 array items per level (with "more" markers). The panel
  lazily requests deeper slices by path (`get-slice`).
- Edits are path-based: panel sends `{storeId, path, json}`; the agent parses, applies an
  immutable `setIn` from the root, and commits via the tier-appropriate mechanism. Only
  paths through plain objects/arrays are editable.

## Message protocol (summary)

Panel → agent: `init`, `rescan`, `get-slice`, `edit-state`, `start-pick`, `stop-pick`,
`highlight-component`, `clear-highlight`, `set-component-state`.
Agent → panel: `environment`, `stores`, `store-state`, `slice`, `edit-result`,
`pick-state`, `component-selected`, `agent-ready`, `error`.
Page ↔ content bridge messages are wrapped in `{__rri: "to-agent"|"to-panel", msg}`;
the service worker only routes by tab id.

## Error handling

- The agent never throws into the page: all handlers are wrapped; failures return
  `{type:"error"}` messages rendered as toasts in the panel.
- Navigation/SPA reloads: the content bridge reconnects; the agent announces
  `agent-ready`; the panel re-inits automatically. Stale store/component ids answer
  with an error.
- Pages without React/Redux: panel shows a friendly empty state with a Rescan button.

## Testing

- Unit tests (`node --test`): serialization round-trips, path `setIn`/`getIn`, the
  devtools-shim enhancer override semantics (against a minimal `createStore`), and
  fiber display-name extraction on mock fibers.
- `demo/index.html`: React 18 + Redux + react-redux (UMD via CDN) app with a class
  component, a hooks component, and two stores — for manual verification after
  `npm run build` → load `dist/` unpacked.

## Out of scope (YAGNI)

Action log/time-travel, Redux Toolkit query inspection, profiling, a full component tree
browser (picker-only selection), Firefox support, options page.
