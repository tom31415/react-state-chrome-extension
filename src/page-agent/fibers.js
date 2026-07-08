// Access to React internals, by object shape rather than version:
//  - "fiber":  React 16+ Fiber nodes (`.tag` number, `.return` link)
//  - "legacy": React 15 internal instances (`._currentElement`)
// A "comp" is `{ kind: 'fiber' | 'legacy', ref }`.

import { serialize, describeElement } from '../shared/serialize.js';

const HOST_COMPONENT = 5;
const HOST_TEXT = 6;

function refOnElement(el) {
  let keys;
  try {
    keys = Object.keys(el);
  } catch {
    return null;
  }
  for (const key of keys) {
    if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
      const v = el[key];
      if (!v) continue;
      if (typeof v.tag === 'number' && 'return' in v) return { kind: 'fiber', ref: v };
      if (v._currentElement !== undefined) return { kind: 'legacy', ref: v };
    } else if (key.startsWith('__reactContainer$')) {
      const v = el[key];
      if (v && typeof v.tag === 'number') return { kind: 'fiber', ref: v };
    }
  }
  return null;
}

export function hasReactKey(el) {
  return refOnElement(el) !== null;
}

// Nearest React-owned ancestor's internal ref for a DOM node.
export function getReactRefFromNode(node) {
  let el = node instanceof Element ? node : node && node.parentElement;
  while (el) {
    const found = refOnElement(el);
    if (found) return found;
    el = el.parentElement;
  }
  return null;
}

function isCompositeFiber(f) {
  const t = f.type;
  if (typeof t === 'function') return true;
  if (t && typeof t === 'object') {
    // forwardRef has .render, memo has .type
    return typeof t.render === 'function' || !!t.type;
  }
  return false;
}

// Nearest user component enclosing the given ref.
export function nearestComposite(refObj) {
  if (!refObj) return null;
  if (refObj.kind === 'fiber') {
    let f = refObj.ref;
    while (f) {
      if (isCompositeFiber(f)) return { kind: 'fiber', ref: f };
      f = f.return;
    }
    return null;
  }
  const inst = refObj.ref;
  const el = inst._currentElement;
  if (el && typeof el.type === 'function') return refObj;
  // Host instance: the composite that created this element.
  if (el && el._owner) return { kind: 'legacy', ref: el._owner };
  return null;
}

export function getDisplayName(type) {
  if (typeof type === 'string') return type;
  if (typeof type === 'function') return type.displayName || type.name || 'Anonymous';
  if (type && typeof type === 'object') {
    if (typeof type.render === 'function') {
      const inner = type.render.displayName || type.render.name || '';
      return `ForwardRef(${inner})`;
    }
    if (type.type) return `Memo(${getDisplayName(type.type)})`;
  }
  return 'Unknown';
}

function isClassFiber(f) {
  return typeof f.type === 'function' && !!(f.type.prototype && f.type.prototype.isReactComponent);
}

function extractHooks(fiber) {
  const hooks = [];
  let h = fiber.memoizedState;
  let i = 0;
  while (h && typeof h === 'object' && 'memoizedState' in h && i < 50) {
    hooks.push(describeHook(h, i));
    h = h.next;
    i++;
  }
  return hooks;
}

function describeHook(h, index) {
  const ms = h.memoizedState;
  if (ms && typeof ms === 'object' && typeof ms.create === 'function' && 'deps' in ms) {
    return { index, kind: 'effect', value: null };
  }
  if (ms && typeof ms === 'object' && 'current' in ms && Object.keys(ms).length === 1) {
    return { index, kind: 'ref', value: serialize(ms.current, 4) };
  }
  return { index, kind: h.queue ? 'state' : 'other', value: serialize(ms, 4) };
}

// Fibers are double-buffered: after a re-render the fiber we captured may be
// the stale alternate, and no pointer on the fiber or instance reliably says
// which generation is mounted. Climb to the FiberRoot (shared by both
// generations of the HostRoot) and search its current tree for the fiber or
// its alternate.
export function toCurrentFiber(f) {
  if (!f || !f.alternate) return f;
  let top = f;
  while (top.return) top = top.return;
  const fiberRoot = top.stateNode;
  const currentRoot = fiberRoot && fiberRoot.current;
  if (!currentRoot) return f;
  let found = null;
  walkFiberTree(currentRoot, (node) => {
    if (node === f || node === f.alternate) {
      found = node;
      return false;
    }
  });
  return found || f;
}

export function describeComponent(comp) {
  if (comp.kind === 'fiber') {
    const f = toCurrentFiber(comp.ref);
    const isClass = isClassFiber(f);
    let kind = 'function';
    if (isClass) kind = 'class';
    else if (f.type && typeof f.type === 'object') kind = f.type.render ? 'forwardRef' : 'memo';
    return {
      name: getDisplayName(f.type),
      kind,
      reactKind: 'fiber',
      props: serialize(f.memoizedProps, 6),
      state: isClass ? serialize(f.memoizedState, 6) : null,
      hooks: isClass || typeof f.type === 'string' ? [] : extractHooks(f),
      key: f.key != null ? String(f.key) : null,
      canEditState: isClass && !!f.stateNode,
      ownerName: f._debugOwner ? getDisplayName(f._debugOwner.type) : null,
      source: f._debugSource
        ? `${f._debugSource.fileName}:${f._debugSource.lineNumber}`
        : null,
    };
  }
  const inst = comp.ref;
  const el = inst._currentElement;
  const pub = inst._instance;
  const isClass = !!(pub && typeof pub.setState === 'function' && pub.state !== undefined);
  return {
    name: getDisplayName(el && el.type),
    kind: pub && typeof pub.setState === 'function' ? 'class' : 'function',
    reactKind: 'legacy',
    props: serialize(el && el.props, 6),
    state: isClass ? serialize(pub.state, 6) : null,
    hooks: [],
    key: el && el.key != null ? String(el.key) : null,
    canEditState: !!(pub && typeof pub.setState === 'function'),
    ownerName:
      el && el._owner && el._owner._currentElement
        ? getDisplayName(el._owner._currentElement.type)
        : null,
    source: null,
  };
}

export function getPublicInstance(comp) {
  if (comp.kind === 'fiber') return toCurrentFiber(comp.ref).stateNode || null;
  return comp.ref._instance || null;
}

export function getHostNode(comp) {
  try {
    if (comp.kind === 'fiber') {
      const queue = [toCurrentFiber(comp.ref)];
      let n = 0;
      while (queue.length && n++ < 2000) {
        const cur = queue.shift();
        if (!cur) continue;
        if ((cur.tag === HOST_COMPONENT || cur.tag === HOST_TEXT) && cur.stateNode) {
          return cur.stateNode;
        }
        if (cur.child) {
          let c = cur.child;
          while (c) {
            queue.push(c);
            c = c.sibling;
          }
        }
      }
      return null;
    }
    return typeof comp.ref.getHostNode === 'function' ? comp.ref.getHostNode() : null;
  } catch {
    return null;
  }
}

export function walkFiberTree(rootFiber, visit, cap = 50000) {
  let node = rootFiber;
  let n = 0;
  while (node && n < cap) {
    n++;
    if (visit(node) === false) return;
    if (node.child) {
      node = node.child;
      continue;
    }
    while (node && node !== rootFiber && !node.sibling) node = node.return;
    if (!node || node === rootFiber) return;
    node = node.sibling;
  }
}

export function walkLegacyTree(rootInst, visit, cap = 50000) {
  const stack = [rootInst];
  let n = 0;
  while (stack.length && n < cap) {
    const inst = stack.pop();
    n++;
    if (!inst || typeof inst !== 'object') continue;
    if (visit(inst) === false) return;
    if (inst._renderedComponent) stack.push(inst._renderedComponent);
    if (inst._renderedChildren && typeof inst._renderedChildren === 'object') {
      for (const k in inst._renderedChildren) stack.push(inst._renderedChildren[k]);
    }
  }
}

function topmost(refObj) {
  if (refObj.kind === 'fiber') {
    let f = refObj.ref;
    while (f.return) f = f.return;
    return { kind: 'fiber', ref: f };
  }
  const inst = refObj.ref;
  const wrapper = inst._hostContainerInfo && inst._hostContainerInfo._topLevelWrapper;
  if (wrapper) return { kind: 'legacy', ref: wrapper };
  let cur = inst;
  while (cur._currentElement && cur._currentElement._owner) cur = cur._currentElement._owner;
  return { kind: 'legacy', ref: cur };
}

// Scan the DOM for React roots. Used as a fallback when the devtools hook was
// already claimed by another extension, and always for React 15.
export function findReactRootsInDom(maxElements = 20000) {
  const roots = [];
  const seen = new Set();
  if (!document.body) return roots;
  const all = document.querySelectorAll('body, body *');
  let count = 0;
  for (const el of all) {
    if (++count > maxElements) break;
    // Only probe elements at a react-tree boundary; children resolve to the same root.
    if (el.parentElement && hasReactKey(el.parentElement)) continue;
    const found = refOnElement(el);
    if (!found) continue;
    const top = topmost(found);
    if (seen.has(top.ref)) continue;
    seen.add(top.ref);
    roots.push(top);
  }
  return roots;
}

export { describeElement };
