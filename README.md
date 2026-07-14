# React + State Inspector

A Chrome DevTools extension (Manifest V3) for debugging React applications — **React 15
and newer** — with first-class Redux and React Query support:

- **Detects React** on the page and reports the version(s), whether the app uses fibers
  (React 16+) or legacy internal instances (React 15).
- **Lists all Redux stores** it can find and shows each store's current state as a live,
  expandable tree.
- **Live state editing**: double-click any value in a store's state tree to change it and
  watch the app update.
- **Visual component picker**: click "Pick component", hover the page to see components
  highlighted by name, and click to select. The panel shows the component's name, kind
  (class / function / memo / forwardRef), props, state, and hooks — and lets you edit
  class component state.
- **React Query support**: detects `@tanstack/react-query` (v4/v5) `QueryClient` instances,
  lists their queries and mutations live, and lets you inspect data, edit it, and
  refetch/invalidate/reset/remove individual queries.

## Install

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` directory. Open DevTools on any React page and switch to the
**React+State** panel.

`demo/index.html` is a ready-made playground (React 18 + Redux + react-redux via CDN)
with a class component, a hooks component, and two stores.

## How store discovery works

| Tier | How the store is found | Edit behavior |
|------|------------------------|---------------|
| **1 — enhancer** | The extension shims `window.__REDUX_DEVTOOLS_EXTENSION__` / `__REDUX_DEVTOOLS_EXTENSION_COMPOSE__` before the app runs. Any store created through them (which includes Redux Toolkit's `configureStore` with devtools enabled, the default) is registered with its reducer wrapped. | **Persistent** — edits become the store's real state; subsequent actions reduce from the edited state. |
| **2 — explicit** | The app calls `window.__REACT_STATE_INSPECTOR__.register(store, 'label')`. | Ephemeral (see below). |
| **3 — discovered** | The extension walks the React tree looking for react-redux `Provider`s (`props.store` or context `value.store`) and checks common globals like `window.store`. | **Ephemeral** — `getState` is patched to return the edited state and subscribers re-render, but the next real dispatched action recomputes state from the store's own reducer and the edit is discarded. The panel labels these stores "ephemeral edit". |

If the real Redux DevTools extension is installed, the shim chains to it — both tools work.

If the real React DevTools extension is installed, its global hook is left untouched and
this extension falls back to scanning the DOM for React roots (fully supported; the
"Rescan" button re-runs discovery at any time).

## How React Query support works

`QueryClientProvider`'s `client` prop is found the same way react-redux's `Provider` store
is (a fiber-tree walk), plus a window-global fallback (`window.queryClient`, etc.) — React
Query has no enhancer-style interception point the way Redux DevTools does, so there's no
"tier 1" equivalent. That also means every discovered client already exposes its full public
API: unlike Redux, there's no ephemeral-vs-persistent split — edits and actions
(Refetch/Invalidate/Reset/Remove) always take full, real effect.

## Development

```bash
npm run watch    # rebuild on change (reload the extension in chrome://extensions after)
npm test         # unit tests (node --test) — fast, no browser needed
npm run test:e2e # regression suite against the REAL extension in a real (headless) Chromium
npm run test:all # both
```

### Testing

`test/*.test.mjs` covers pure logic (serialization, path edits, fiber/legacy component
reading, the Redux devtools shim, the store registry, tree search/formatting) with plain
`node --test` + `node:assert` — no browser involved, runs in well under a second.

`e2e/*.e2e.mjs` is the regression suite: it builds the extension, loads it into a real
Chromium via `playwright-core` (`--load-extension`, not a mocked API), and drives the demo
app (`demo/agent-test.html`) through the actual panel UI — clicking buttons, typing into
search boxes, double-clicking to edit values — exactly as a person would. `e2e/harness.mjs`
holds the shared setup (serving the repo, launching the extension, and the message-relay
`pump`/`settle` helpers that stand in for the real content-script/service-worker routing,
since the panel here is a plain page with `chrome.devtools`/`chrome.runtime` mocked rather
than a real DevTools panel window). Each file gets its own browser session; `--test-concurrency`
is capped in `test:e2e` because running many real Chromium instances fully in parallel
causes resource-contention timeouts, not real failures.

When fixing a bug or adding a feature, add a test in whichever suite matches where the
behavior actually lives — pure logic in `test/`, anything that needs a real DOM/browser/
extension in `e2e/`.

Architecture (see `docs/specs/` for the full design):

```
DevTools panel  <-- port -->  service worker  <-- port -->  content script  <-- postMessage -->  page agent
 src/devtools                 src/background               src/content (ISOLATED)               src/page-agent (MAIN world)
```

The page agent is the only piece with access to page JavaScript. It installs the React
devtools hook and Redux shim at `document_start`, resolves DOM nodes to React components
by object shape (fibers for 16+, internal instances for 15), and applies state edits.

## Limitations

- Hook values are read-only (React offers no supported way to set them from outside);
  class component state is editable.
- Stores discovered without the enhancer (tier 2/3) get ephemeral edits only — Redux
  does not expose a created store's reducer, so a persistent override is impossible there.
  Additionally, apps on react-redux **v8+** may not repaint immediately after an ephemeral
  edit (`useSyncExternalStore` captures the pre-patch `getState`); the store and the panel
  see the edited state, and the app picks it up on its next render. react-redux ≤7,
  `connect()`, and manual subscribers repaint immediately.
- Values that aren't plain JSON (functions, Maps, class instances…) are shown but not
  editable as a whole.
