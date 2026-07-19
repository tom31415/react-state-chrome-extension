# Development

Documentation for building, testing, and understanding the extension. If you just
want to *use* the extension, see the [README](../README.md).

## Build & load unpacked

```bash
npm install
npm run build
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` directory.

`demo/index.html` is a small playground (React 18 + Redux + react-redux via CDN) with a
class component, a hooks component, and two stores.

For a richer testbed, `demo/signal-room/signal-room.html` wires Redux, Context API, and
React Query into a single page — the same page used to capture the Chrome Web Store
screenshots. Serve the repo with `python3 -m http.server 8000` and open
`http://localhost:8000/demo/signal-room/signal-room.html`.

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

## Scripts

```bash
npm run watch    # rebuild on change (reload the extension in chrome://extensions after)
npm test         # unit tests (node --test) — fast, no browser needed
npm run test:e2e # regression suite against the REAL extension in a real (headless) Chromium
npm run test:all # both
```

## Testing

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

## Architecture

See `docs/specs/` for the full design.

```
DevTools panel  <-- port -->  service worker  <-- port -->  content script  <-- postMessage -->  page agent
 src/devtools                 src/background               src/content (ISOLATED)               src/page-agent (MAIN world)
```

The page agent is the only piece with access to page JavaScript. It installs the React
devtools hook and Redux shim at `document_start`, resolves DOM nodes to React components
by object shape (fibers for 16+, internal instances for 15), and applies state edits.

## Publishing to the Chrome Web Store

Assets and copy live at the repo root:

- `STORE_LISTING.md` — dashboard copy (short/detailed description, category, single-purpose
  statement, and per-permission justifications).
- `store-assets/` — the required promo tile (440×280), the optional marquee tile
  (1400×560), and the panel screenshots (1280×800), plus a README documenting each asset.

Steps:

1. `npm run build`
2. Zip the **contents** of `dist/` (the zip's top level must contain `manifest.json`).
3. Upload the zip to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
4. Paste the fields from `STORE_LISTING.md` and upload the images from `store-assets/`.
