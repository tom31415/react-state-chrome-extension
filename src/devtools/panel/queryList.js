// Renders the flat list of queries or mutations sent by the agent as
// searchable rows with status badges — no nesting (unlike componentTree.js),
// since each query/mutation is an independent cache entry, not a tree.
// Search matching and badge derivation are pure functions so they're
// unit-testable without a DOM, mirroring componentTree.js's
// computeSearchVisibility.

export function matchesQuery(row, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return row.keyDisplay.toLowerCase().includes(q) || (row.clientLabel || '').toLowerCase().includes(q);
}

// One badge per row: 'error' beats 'fetching' beats 'stale' beats 'fresh'.
// 'fetching' also covers a first-ever load (status 'pending' means no data
// has ever arrived yet). Mutation rows carry no fetchStatus/isStale (both
// undefined), so they always land on 'fresh' unless status is 'error'.
export function deriveBadge(row) {
  if (row.status === 'error') return 'error';
  if (row.fetchStatus === 'fetching' || row.status === 'pending') return 'fetching';
  if (row.isStale) return 'stale';
  return 'fresh';
}

const BADGE_CLASS = { error: 'chip-err', fetching: 'chip-warn', stale: 'chip-warn', fresh: 'chip-ok' };

export function createQueryList(container, opts = {}) {
  let rows = [];
  let query = '';
  let selectedId = null;

  function setData(next) {
    rows = next;
    render();
  }

  function setQuery(next) {
    query = next;
    render();
  }

  function setSelected(id) {
    selectedId = id;
    render();
  }

  function render() {
    // A full teardown-and-rebuild collapses the container to empty (however
    // briefly) before its content grows back — preserve scrollTop explicitly
    // (try/finally: several branches below return early), matching tree.js
    // and componentTree.js.
    const scrollTop = container.scrollTop;
    try {
      container.textContent = '';
      if (rows.length === 0) {
        container.appendChild(emptyState(opts.emptyMessage || 'Nothing here yet.'));
        return;
      }
      const visible = rows.filter((r) => matchesQuery(r, query));
      if (visible.length === 0) {
        container.appendChild(emptyState(`No matches for "${query}".`));
        return;
      }
      const frag = document.createDocumentFragment();
      for (const row of visible) frag.appendChild(renderRow(row));
      container.appendChild(frag);
    } finally {
      container.scrollTop = scrollTop;
    }
  }

  function renderRow(row) {
    const el = document.createElement('div');
    el.className = 'query-row' + (row.id === selectedId ? ' selected' : '');

    const kind = deriveBadge(row);
    const badge = document.createElement('span');
    badge.className = `chip ${BADGE_CLASS[kind]}`;
    badge.textContent = kind;
    el.appendChild(badge);

    if (row.clientLabel) {
      const clientEl = document.createElement('span');
      clientEl.className = 'query-client';
      clientEl.textContent = `[${row.clientLabel}]`;
      el.appendChild(clientEl);
    }

    const key = document.createElement('span');
    key.className = 'query-key';
    key.textContent = row.keyDisplay;
    el.appendChild(key);

    el.addEventListener('click', () => opts.onSelect && opts.onSelect(row.id));
    return el;
  }

  return { setData, setQuery, setSelected };
}

function emptyState(text) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  return empty;
}
