# Chrome Web Store assets

## Files here

- `promo-tile-440x280.png` — small promo tile (required by CWS for publishing). Icon + name + tagline on the brand-navy background.
- `screenshot-1280x800.png` — Stores tab in action against the `demo/signal-room/signal-room.html` sample page, showing the Redux Provider store with its live state tree (counter + tasks array) expanded and editable.

## Adding more screenshots

CWS allows up to 5 screenshots per listing. Additional views worth capturing:

- **Component tab** — a component selected via the element picker, with props/state/hooks visible.
- **Queries tab** — the React Query list with a query selected and its data tree open.
- **Highlight updates** in action on a demo app.
- **Action history** pane open showing dispatched actions with jump-to-state.

Capture at exactly **1280×800** (or **640×400**). The `demo/signal-room/signal-room.html` page is designed to exercise all four extension tabs — served locally (`python3 -m http.server 8000` from the repo root) it makes a good screenshot target.
