# Chrome Web Store assets

## Files here

- `promo-tile-440x280.png` — small promo tile (required by CWS for publishing). Icon + name + tagline on the brand-navy background.
- `screenshot-1-stores-1280x800.png` — Stores tab: the signal-room Redux Provider store with its live state tree (counter + tasks array) expanded and editable.
- `screenshot-2-component-1280x800.png` — Component tab: the signal-room component tree with `<QueryPanel>` selected, showing its fiber kind, props, and hooks list.
- `screenshot-3-queries-1280x800.png` — Queries tab: the `["systemStats"]` React Query with status/actions and an editable data tree.

## Adding more screenshots

CWS allows up to 5 screenshots per listing. Two more views worth capturing:

- **Highlight updates** in action on a demo app.
- **Action history** pane open showing dispatched actions with jump-to-state.

Capture at exactly **1280×800** (or **640×400**). The `demo/signal-room/signal-room.html` page is designed to exercise all four extension tabs — served locally (`python3 -m http.server 8000` from the repo root) it makes a good screenshot target.
