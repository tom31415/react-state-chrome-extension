# Chrome Web Store assets

## Files here

- `promo-tile-440x280.png` — small promo tile (required by CWS for publishing). Icon + name + tagline on the brand-navy background.
- `screenshot-1280x800.png` — a padded version of `rri-demo-verified.png`, sized to the CWS-required 1280×800.

## ⚠️ Screenshot is a placeholder

`screenshot-1280x800.png` is generated from `rri-demo-verified.png` in the repo root, which shows the **demo test page**, not the extension's DevTools panel. Uploading this as the primary screenshot risks a review rejection (screenshots must represent the extension's actual functionality).

Before submitting, replace `screenshot-1280x800.png` with real screenshots of the **React+State DevTools panel** in action. Ideas for good screenshots:

1. **Stores tab** — the Redux store list with a store selected and its live state tree expanded.
2. **Component tab** — a component selected via the element picker, with props/state/hooks visible.
3. **Queries tab** — the React Query list with a query selected and its data tree open.
4. **Highlight updates** in action on a demo app.
5. **Action history** pane open showing dispatched actions with jump-to-state.

Capture at exactly **1280×800** (or **640×400**). Use a real app (the repo's `demo/index.html` is a decent target, or your own React app). Up to 5 screenshots can be uploaded to the CWS listing.
