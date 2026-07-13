// Expandable tree renderer for serialized state (see shared/serialize.js).
// Paths handed to callbacks are REAL state paths: descending into an `obj`
// wrapper uses the original keys, and non-addressable children (map/set
// entries, truncation markers) carry no path and are read-only.

import { TAG, isTagged } from '../../shared/serialize.js';

export function createTree(container, opts = {}) {
  const expanded = new Set([pathKey([])]);
  let root;
  let query = '';

  function setData(node) {
    root = node;
    render();
  }

  function setQuery(next) {
    query = next;
    render();
  }

  function render() {
    // A full teardown-and-rebuild collapses the container to empty (however
    // briefly) before its content grows back, which some rebuild paths use
    // as the trigger to clamp scrollTop to 0 — preserve it explicitly
    // (try/finally: this has more than one return point) rather than rely
    // on the browser to leave it alone across that gap.
    const scrollTop = container.scrollTop;
    try {
      container.textContent = '';
      const rootLabel = opts.rootLabel || 'state';
      const visible = computeTreeSearchVisibility(rootLabel, root, query);
      if (visible && !visible.has(pathKey([]))) {
        container.appendChild(el('div', 'empty', `No values match "${query}".`));
        return;
      }
      container.appendChild(renderNode(rootLabel, root, [], !!opts.onEdit, 0, true, visible));
    } finally {
      container.scrollTop = scrollTop;
    }
  }

  function renderNode(label, node, path, canEdit, depth, pathIsReal, visible) {
    const frag = document.createDocumentFragment();
    const info = classify(node);
    const row = el('div', 'tree-row');
    row.style.paddingLeft = `${depth * 14 + 4}px`;

    const key = pathKey(path);
    // While a search is active, force everything visible open — collapse
    // state stays untouched underneath and reapplies once search is cleared.
    const isOpen = visible ? true : expanded.has(key);

    if (info.container) {
      const twisty = el('span', 'twisty', isOpen ? '▾' : '▸');
      twisty.addEventListener('click', () => {
        if (expanded.has(key)) expanded.delete(key);
        else expanded.add(key);
        render();
      });
      row.appendChild(twisty);
    } else {
      row.appendChild(el('span', 'twisty twisty-none', ''));
    }

    row.appendChild(el('span', 'tree-key', label));
    row.appendChild(el('span', 'tree-sep', ': '));

    const valueSpan = el('span', `tree-value ${info.className || ''}`, info.display);
    row.appendChild(valueSpan);

    if (info.loadable && opts.onLoadDepth) {
      const load = el('button', 'tree-load', 'load');
      load.addEventListener('click', () => opts.onLoadDepth(path));
      row.appendChild(load);
    }

    const editableHere =
      canEdit && opts.onEdit && (info.editableLeaf || info.container) && path.length > 0;
    if (editableHere) {
      row.classList.add('editable');
      row.title = 'Double-click to edit';
      row.addEventListener('dblclick', (e) => {
        e.preventDefault();
        beginEdit(row, valueSpan, node, path, info);
      });
    }

    const copyValueBtn = el('button', 'tree-copy', '⧉');
    copyValueBtn.title = 'Copy value as JSON';
    copyValueBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(safeStringifyForCopy(node), opts.onToast);
    });
    row.appendChild(copyValueBtn);

    if (pathIsReal) {
      const copyPathBtn = el('button', 'tree-copy', 'path');
      copyPathBtn.title = 'Copy path';
      copyPathBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        copyToClipboard(formatPath(opts.rootLabel || 'state', path), opts.onToast);
      });
      row.appendChild(copyPathBtn);
    }

    frag.appendChild(row);

    if (info.container && isOpen) {
      for (const child of info.children()) {
        const childPath = child.seg == null ? null : [...path, child.seg];
        const cp = childPath || [...path, ` ${child.label}`];
        if (visible && !visible.has(pathKey(cp))) continue;
        frag.appendChild(
          renderNode(
            child.label,
            child.node,
            cp,
            canEdit && childPath != null && info.editableContainer,
            depth + 1,
            childPath != null,
            visible
          )
        );
      }
    }
    return frag;
  }

  function beginEdit(row, valueSpan, node, path, info) {
    if (row.querySelector('input')) return;
    let initial;
    try {
      initial = JSON.stringify(reconstruct(node));
    } catch (err) {
      if (info.container) {
        if (opts.onToast) {
          opts.onToast(
            `Cannot edit this value as a whole: ${err.message}. Edit its children instead.`,
            'warn'
          );
        }
        return;
      }
      initial = '';
    }
    if (initial === undefined) initial = '';
    const input = el('input', 'tree-edit');
    input.value = initial;
    valueSpan.replaceWith(input);
    input.focus();
    input.select();
    // Removing the focused input below fires a synchronous native `blur`,
    // which re-enters this closure via the blur listener before the Enter
    // path below ever reaches onEdit. Guard so that reentrant call is a
    // no-op instead of throwing on the already-detached input and aborting
    // the real commit.
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      input.replaceWith(valueSpan);
      if (!commit) return;
      const text = input.value.trim();
      if (text === initial || text === '') return;
      let json;
      try {
        JSON.parse(text);
        json = text;
      } catch {
        json = JSON.stringify(text); // bare words become strings
      }
      opts.onEdit(path, json);
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(false));
  }

  return { setData, render, setQuery };
}

export function pathKey(path) {
  return JSON.stringify(path);
}

// Returns the set of path-keys that must stay visible for a case-insensitive
// substring search over KEY NAMES (not values — matching every leaf's
// serialized text would mean re-stringifying the whole tree on every
// keystroke, and name-only matching is what the component tree's search
// already does). A node is visible if its own key matches OR any
// descendant's does, which keeps every ancestor of a match visible too.
// `null` means "no active search, show everything, ignore this set".
export function computeTreeSearchVisibility(rootLabel, rootNode, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set();

  function visit(label, node, path) {
    let matches = label.toLowerCase().includes(q);
    const info = classify(node);
    if (info.container) {
      for (const child of info.children()) {
        const childPath = child.seg == null ? null : [...path, child.seg];
        const cp = childPath || [...path, ` ${child.label}`];
        if (visit(child.label, child.node, cp)) matches = true;
      }
    }
    if (matches) visible.add(pathKey(path));
    return matches;
  }

  visit(rootLabel, rootNode, []);
  return visible;
}

// Turns a real state path into a JS-accessor-like expression a developer can
// paste into code or a bug report, e.g. `state.user["display-name"][2]`.
export function formatPath(rootLabel, path) {
  let expr = rootLabel;
  for (const seg of path) {
    if (/^\d+$/.test(seg)) {
      expr += `[${seg}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)) {
      expr += `.${seg}`;
    } else {
      expr += `[${JSON.stringify(seg)}]`;
    }
  }
  return expr;
}

function copyToClipboard(text, onToast) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    if (onToast) onToast('Clipboard API is not available.', 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => onToast && onToast('Copied to clipboard.', 'ok'),
    (err) => onToast && onToast(`Copy failed: ${String((err && err.message) || err)}`, 'error')
  );
}

// Best-effort JSON for the copy-value button — falls back to whatever the
// tree currently displays for values that aren't reconstructable JSON.
function safeStringifyForCopy(node) {
  try {
    return JSON.stringify(reconstruct(node), null, 2);
  } catch {
    return String(classify(node).display);
  }
}

// Best-effort inverse of serialize() for editing; throws on non-JSON nodes.
export function reconstruct(node) {
  if (node === null || typeof node === 'boolean' || typeof node === 'number' || typeof node === 'string') {
    return node;
  }
  if (Array.isArray(node)) return node.map(reconstruct);
  if (isTagged(node)) {
    const kind = node[TAG];
    if (kind === 'obj') {
      if (node.total) {
        // Only MAX_KEYS of node.total keys were serialized; writing this back
        // whole would delete the rest from real state.
        throw new Error('Object was truncated for display; edit its keys individually');
      }
      return reconstruct(node.v);
    }
    if (kind === 'undef') throw new Error('undefined is not JSON');
    if (kind === 'more' || kind === 'str' || kind === 'depth') {
      throw new Error('Value was truncated for display; edit deeper values individually');
    }
    throw new Error(`Cannot reconstruct ${kind}`);
  }
  if (typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = reconstruct(v);
    return out;
  }
  throw new Error('Cannot reconstruct value');
}

function classify(node) {
  if (node === null) return leaf('null', 'v-null');
  const t = typeof node;
  if (t === 'boolean' || t === 'number') return leaf(String(node), 'v-number', true);
  if (t === 'string') return leaf(JSON.stringify(node), 'v-string', true);

  if (Array.isArray(node)) {
    return {
      container: true,
      editableContainer: true,
      display: `Array(${node.length})`,
      className: 'v-dim',
      children: () =>
        node.map((child, i) =>
          isTagged(child) && child[TAG] === 'more'
            ? { label: '…', node: child, seg: null }
            : { label: String(i), node: child, seg: String(i) }
        ),
    };
  }

  if (isTagged(node)) {
    switch (node[TAG]) {
      case 'obj': {
        const keys = Object.keys(node.v);
        const name = node.ctor ? `${node.ctor} ` : '';
        const total = node.total ? ` of ${node.total}` : '';
        return {
          container: true,
          editableContainer: true,
          display: `${name}{${keys.length} keys${total}}`,
          className: 'v-dim',
          children: () => keys.map((k) => ({ label: k, node: node.v[k], seg: k })),
        };
      }
      case 'map':
        return {
          container: true,
          editableContainer: false,
          display: `Map(${node.size})`,
          className: 'v-dim',
          children: () =>
            node.entries.map((pair, i) => ({ label: String(i), node: pair, seg: null })),
        };
      case 'set':
        return {
          container: true,
          editableContainer: false,
          display: `Set(${node.size})`,
          className: 'v-dim',
          children: () =>
            node.values.map((v, i) => ({ label: String(i), node: v, seg: null })),
        };
      case 'depth':
        return { ...leaf(node.preview || '…', 'v-dim'), loadable: true };
      case 'str':
        return leaf(`${JSON.stringify(node.v)}… (${node.len} chars)`, 'v-string', true);
      case 'num':
        return leaf(node.v, 'v-number', true);
      case 'undef':
        return leaf('undefined', 'v-null', true);
      case 'bigint':
        return leaf(`${node.v}n`, 'v-number');
      case 'fn':
        return leaf(`ƒ ${node.name || ''}()`, 'v-fn');
      case 'sym':
      case 'regexp':
      case 'opaque':
      case 'element':
        return leaf(String(node.v), 'v-dim');
      case 'date':
        return leaf(`Date(${node.v})`, 'v-dim');
      case 'error':
        return leaf(`${node.name}: ${node.message}`, 'v-error');
      case 'circular':
        return leaf('[circular]', 'v-dim');
      case 'more':
        return leaf(`+${node.count} more`, 'v-dim');
      default:
        return leaf(`[${node[TAG]}]`, 'v-dim');
    }
  }

  const keys = Object.keys(node);
  return {
    container: true,
    editableContainer: true,
    display: `{${keys.length} ${keys.length === 1 ? 'key' : 'keys'}}`,
    className: 'v-dim',
    children: () => keys.map((k) => ({ label: k, node: node[k], seg: k })),
  };
}

function leaf(display, className, editableLeaf = false) {
  return { container: false, display, className, editableLeaf };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
