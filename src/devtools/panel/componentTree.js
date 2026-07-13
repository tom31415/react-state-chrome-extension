// Renders the composite-component forest sent by the agent (component-tree
// message) as an expandable, searchable tree. Search/matching is a pure
// function (computeSearchVisibility) so it's unit-testable without a DOM,
// mirroring how tree.js keeps classify/reconstruct DOM-free.

export function pathKey(path) {
  return JSON.stringify(path);
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

  function setData(next) {
    data = next;
    render();
  }

  function setQuery(next) {
    query = next;
    render();
  }

  function render() {
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
  }

  function renderNode(node, path, visible, depth) {
    const frag = document.createDocumentFragment();
    const row = document.createElement('div');
    row.className = 'component-row';
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

  return { setData, setQuery };
}

function emptyState(text) {
  const empty = document.createElement('div');
  empty.className = 'empty';
  empty.textContent = text;
  return empty;
}
