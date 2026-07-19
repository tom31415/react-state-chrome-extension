# Chrome Web Store — listing draft

Copy-paste values into the Chrome Web Store developer dashboard when submitting.

## Item summary

- **Name:** React + State Inspector
- **Category:** Developer Tools
- **Language:** English
- **Short description (max 132 chars):**
  Inspect React (v15+) components visually and view/edit Redux and React Query state live from a DevTools panel.

## Detailed description

A React inspector for real developers to inspect components, props, Redux, React Query, and Context API — live, from a dedicated Chrome DevTools panel.

Features:

- **Component inspector** — visually pick any element on the page and see its React component, props, state, hooks, context, owner, and DOM node. Works with React 15 (legacy) and React 16+ (fibers).
- **Redux stores** — automatic detection of Redux stores (including react-redux and manually registered stores). View live state as an editable tree. Full edit for enhancer-registered stores, ephemeral edit for others.
- **Action history** — see the last 50 dispatched actions per store; jump to any past state.
- **React Query** — inspect queries and mutations, view/edit query data, refetch, invalidate, reset, or remove entries.
- **Highlight updates** — flashes DOM nodes when their component re-renders, like the React DevTools highlight-updates mode.
- **No app changes required** — the extension installs its hooks at document_start; apps do not need to opt in. An optional `window.__REACT_STATE_INSPECTOR__.register(store)` API is available for stores that are created before scanning.

Open Chrome DevTools on any page and switch to the **React+State** panel to start inspecting.

## Permissions — justifications

The Chrome Web Store dashboard asks for a justification per permission at submission time. Paste these into the corresponding fields.

### Single purpose

React + State Inspector adds a single Chrome DevTools panel that lets developers inspect React components and view/edit Redux and React Query state on the page they are debugging.

### Host permission justification (`<all_urls>` in content_scripts.matches)

The extension is a DevTools panel — its entire purpose is to inspect the React app running on whichever tab the developer opens DevTools against. Developers work on apps hosted on arbitrary origins (localhost during development, staging domains, production sites, internal tools), so the content scripts that bridge the page and the panel must be allowed to run on any URL the developer chooses to debug. The extension performs no automated activity on pages — it is entirely driven by the developer opening DevTools and interacting with the panel. It sends no data off-device and communicates only between the inspected tab, the extension's own background service worker, and the DevTools panel.

### `world: "MAIN"` content script justification

The extension needs to observe the page's own React instance and Redux stores. React's internal hook (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) and Redux stores live in the page's JavaScript context, not the extension's isolated content-script context. Running one content script in the MAIN world is the standard, sanctioned way (as used by React DevTools itself) to install the hook before the app's own bundle runs. That MAIN-world script only communicates with the extension's ISOLATED-world content script via `window.postMessage` on the same page — it does not fetch, execute, or inject remote code.

### Remote code

The extension **does not** execute any remote code. All JavaScript is bundled from the extension's own source and ships in the package. There are no `<script src="…">` tags, no `eval`, no dynamic `import()` from remote URLs, and no user-supplied code paths.

### Data handling

The extension does not collect, transmit, or store any user data off-device. All inspection happens locally between the inspected tab, the extension's own background service worker, and the DevTools panel. There is no analytics, no telemetry, no remote server.

Check the corresponding boxes in the "Data usage" / "Privacy practices" tabs:

- I do not collect or use user data.
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Assets to upload

- **Icon (128×128):** `icons/icon128.png` — Chrome Web Store pulls this from the manifest automatically.
- **Small promo tile (440×280, required):** `store-assets/promo-tile-440x280.png`
- **Screenshots (1280×800):**
  - `store-assets/screenshot-1-stores-1280x800.png` — Stores tab
  - `store-assets/screenshot-2-component-1280x800.png` — Component tab
  - `store-assets/screenshot-3-queries-1280x800.png` — Queries tab

  Up to 2 more can be added; see `store-assets/README.md`.
- **Large promo tile (920×680, optional):** *(not provided)*
- **Marquee promo tile (1400×560, optional):** *(not provided)*

## Version numbering

Starting at `0.0.1`. Each new upload to CWS must have a strictly higher version than the previous one. Bump the patch component (`0.0.2`, `0.0.3`, …) for regular updates; minor bumps (`0.1.0`) for larger feature releases.

## Zip layout for upload

Zip the **contents** of `dist/` (not the folder itself) after running `npm run build`. The zip's top level must contain `manifest.json`.
