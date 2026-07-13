// Renders the composite-component forest sent by the agent (component-tree
// message) as an expandable, searchable tree. Search/matching is a pure
// function (computeSearchVisibility) so it's unit-testable without a DOM,
// mirroring how tree.js keeps classify/reconstruct DOM-free.

export function pathKey(path) {
  return JSON.stringify(path);
}

// Structural path of the node with the given id, or null if not present.
export function findPath(roots, id) {
  function visit(node, path) {
    if (node.id === id) return path;
    for (let i = 0; i < node.children.length; i++) {
      const found = visit(node.children[i], [...path, i]);
      if (found) return found;
    }
    return null;
  }
  for (let i = 0; i < roots.length; i++) {
    const found = visit(roots[i], [i]);
    if (found) return found;
  }
  return null;
}

// Returns the set of path-keys that must stay visible for a case-insensitive
// substring search over component names — a node is visible if its own name
// matches OR any descendant's does (which keeps every ancestor of a match
// visible too, since a match anywhere in a subtree makes that whole path
// visible on the way back up). `null` means "no active search, show
// everything, ignore this set".
export function computeSearchVisibility(roots, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set();

  function visit(node, path) {
    let matches = node.name.toLowerCase().includes(q);
    for (let i = 0; i < node.children.length; i++) {
      if (visit(node.children[i], [...path, i])) matches = true;
    }
    if (matches) visible.add(pathKey(path));
    return matches;
  }

  roots.forEach((node, i) => visit(node, [i]));
  return visible;
}

export function createComponentTree(container, opts = {}) {
  // Paths the user explicitly collapsed; everything else defaults open.
  // Keyed by structural path (not node id, which is reassigned on every
  // rebuild) so collapse state survives a tree refresh.
  const collapsed = new Set();
  let data = { roots: [], truncated: false, total: 0 };
  let query = '';
  let selectedId = null;
  // The id we've already expanded-ancestors-and-scrolled-to, so a
  // background tree refresh while the same component stays selected
  // doesn't keep jumping the scroll position back to it.
  let scrolledToId = null;

  function setData(next) {
    data = next;
    render();
    tryRevealSelection();
  }

  function setQuery(next) {
    query = next;
    render();
  }

  // The agent's id-reuse (see registerComponent in the page agent) makes a
  // picked component's id equal an existing tree node's id when they're the
  // same component — but the matching tree data may not have arrived yet
  // (setSelected can race setData in either order), so this is retried from
  // both entry points until a path is actually found.
  function setSelected(id) {
    if (id !== selectedId) scrolledToId = null;
    selectedId = id;
    render();
    tryRevealSelection();
  }

  function tryRevealSelection() {
    if (selectedId == null || selectedId === scrolledToId) return;
    const path = findPath(data.roots, selectedId);
    if (!path) return; // not (yet) in the tree — next setData/setSelected retries
    for (let i = 1; i < path.length; i++) collapsed.delete(pathKey(path.slice(0, i)));
    render();
    const row = container.querySelector('.component-row.selected');
    if (row) row.scrollIntoView({ block: 'nearest' });
    scrolledToId = selectedId;
  }

  function render() {
    // A full teardown-and-rebuild collapses the container to empty (however
    // briefly) before its content grows back, which some rebuild paths use
    // as the trigger to clamp scrollTop to 0 — preserve it explicitly
    // (try/finally: several branches below return early) rather than rely
    // on the browser to leave it alone across that gap.
    const scrollTop = container.scrollTop;
    try {
      container.textContent = '';
      if (data.roots.length === 0) {
        container.appendChild(emptyState('No components found. If your app mounts after this scan, hit Rescan.'));
        return;
      }

      const visible = computeSearchVisibility(data.roots, query);
      const frag = document.createDocumentFragment();
      let anyVisible = false;
      data.roots.forEach((node, i) => {
        const path = [i];
        if (visible && !visible.has(pathKey(path))) return;
        anyVisible = true;
        frag.appendChild(renderNode(node, path, visible, 0));
      });
      container.appendChild(frag);

      if (!anyVisible) {
        container.appendChild(emptyState(`No components match "${query}".`));
      } else if (data.truncated) {
        const note = document.createElement('div');
        note.className = 'tree-note';
        note.textContent = `Showing the first ${data.total} components found — more exist. Narrow your search or inspect a subtree directly.`;
        container.appendChild(note);
      }
    } finally {
      container.scrollTop = scrollTop;
    }
  }

  function renderNode(node, path, visible, depth) {
    const frag = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'component-row' + (node.id === selectedId ? ' selected' : '');
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    const hasChildren = node.children.length > 0;
    const key = pathKey(path);
    // While a search is active, force everything visible open — collapse
    // state stays untouched underneath and reapplies once search is cleared.
    const isOpen = visible ? true : !collapsed.has(key);

    const twisty = document.createElement('span');
    if (hasChildren) {
      twisty.className = 'twisty';
      twisty.textContent = isOpen ? '▾' : '▸';
      twisty.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed.has(key)) collapsed.delete(key);
        else collapsed.add(key);
        render();
      });
    } else {
      twisty.className = 'twisty twisty-none';
    }
    row.appendChild(twisty);

    const name = document.createElement('span');
    name.className = 'component-name';
    name.textContent = node.name;
    row.appendChild(name);

    const badge = document.createElement('span');
    badge.className = `component-kind kind-${node.kind}`;
    badge.textContent = node.kind;
    row.appendChild(badge);

    if (node.key != null) {
      const keyBadge = document.createElement('span');
      keyBadge.className = 'component-key';
      keyBadge.textContent = `key="${node.key}"`;
      row.appendChild(keyBadge);
    }

    if (opts.onFocus) {
      const focusBtn = document.createElement('button');
      focusBtn.className = 'component-focus-btn';
      focusBtn.textContent = 'Focus';
      focusBtn.title = `Scope the tree to <${node.name}> and its descendants`;
      focusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onFocus(node.id);
      });
      row.appendChild(focusBtn);
    }

    row.addEventListener('click', () => opts.onSelect && opts.onSelect(node.id));
    if (opts.onHover) {
      row.addEventListener('mouseenter', () => opts.onHover(node.id));
      row.addEventListener('mouseleave', () => opts.onHover(null));
    }

    frag.appendChild(row);

    if (hasChildren && isOpen) {
      node.children.forEach((child, i) => {
        const childPath = [...path, i];
        if (visible && !visible.has(pathKey(childPath))) return;
        frag.appendChild(renderNode(child, childPath, visible, depth + 1));
      });
    }
    return frag;
  }

  return { setData, setQuery, setSelected };
}

function emptyState(text) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  return empty;
}
