// JSON-safe serialization of arbitrary page values for transport to the panel.
// Non-JSON values become "tagged" nodes: plain objects whose `@rsi` key holds a
// string kind. Raw arrays/objects pass through as JSON containers; a plain object
// that itself contains an `@rsi` key is escaped inside an `obj` wrapper.

export const TAG = '@rsi';

export const MAX_STRING = 5000;
export const MAX_KEYS = 100;
export const MAX_ITEMS = 100;
export const MAX_ENTRIES = 50;
export const DEFAULT_DEPTH = 8;

export function isTagged(node) {
  return (
    node !== null &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    typeof node[TAG] === 'string'
  );
}

export function serialize(value, maxDepth = DEFAULT_DEPTH) {
  return ser(value, maxDepth, new WeakSet());
}

function ser(v, depth, seen) {
  switch (typeof v) {
    case 'boolean':
      return v;
    case 'number':
      return Number.isFinite(v) ? v : { [TAG]: 'num', v: String(v) };
    case 'string':
      return v.length > MAX_STRING
        ? { [TAG]: 'str', v: v.slice(0, MAX_STRING), len: v.length }
        : v;
    case 'undefined':
      return { [TAG]: 'undef' };
    case 'bigint':
      return { [TAG]: 'bigint', v: v.toString() };
    case 'function':
      return { [TAG]: 'fn', name: v.name || '' };
    case 'symbol':
      return { [TAG]: 'sym', v: String(v) };
  }
  if (v === null) return null;

  if (seen.has(v)) return { [TAG]: 'circular' };
  if (depth <= 0) return { [TAG]: 'depth', preview: preview(v) };

  seen.add(v);
  try {
    if (Array.isArray(v)) {
      const n = Math.min(v.length, MAX_ITEMS);
      const out = [];
      for (let i = 0; i < n; i++) out.push(ser(v[i], depth - 1, seen));
      if (v.length > MAX_ITEMS) out.push({ [TAG]: 'more', count: v.length - MAX_ITEMS });
      return out;
    }
    if (v instanceof Date) {
      return { [TAG]: 'date', v: Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString() };
    }
    if (v instanceof RegExp) return { [TAG]: 'regexp', v: String(v) };
    if (v instanceof Error) {
      return { [TAG]: 'error', name: v.name, message: String(v.message) };
    }
    if (typeof Element !== 'undefined' && v instanceof Element) {
      return { [TAG]: 'element', v: describeElement(v) };
    }
    if (v instanceof Map) {
      const entries = [];
      for (const [k, val] of v) {
        if (entries.length >= MAX_ENTRIES) break;
        entries.push([ser(k, depth - 1, seen), ser(val, depth - 1, seen)]);
      }
      return { [TAG]: 'map', size: v.size, entries };
    }
    if (v instanceof Set) {
      const values = [];
      for (const val of v) {
        if (values.length >= MAX_ENTRIES) break;
        values.push(ser(val, depth - 1, seen));
      }
      return { [TAG]: 'set', size: v.size, values };
    }
    return serObject(v, depth, seen);
  } catch (err) {
    return { [TAG]: 'error', name: 'SerializeError', message: String(err && err.message) };
  } finally {
    seen.delete(v);
  }
}

function serObject(v, depth, seen) {
  let keys;
  try {
    keys = Object.keys(v);
  } catch {
    return { [TAG]: 'opaque', v: Object.prototype.toString.call(v) };
  }
  const out = {};
  const n = Math.min(keys.length, MAX_KEYS);
  let needsWrapper = false;
  for (let i = 0; i < n; i++) {
    const k = keys[i];
    if (k === TAG) needsWrapper = true;
    out[k] = ser(safeGet(v, k), depth - 1, seen);
  }
  const proto = Object.getPrototypeOf(v);
  const ctor = proto && proto.constructor;
  const ctorName = ctor && ctor !== Object && ctor.name ? ctor.name : null;
  if (needsWrapper || ctorName || keys.length > MAX_KEYS) {
    const node = { [TAG]: 'obj', v: out };
    if (ctorName) node.ctor = ctorName;
    if (keys.length > MAX_KEYS) node.total = keys.length;
    return node;
  }
  return out;
}

function safeGet(obj, key) {
  try {
    return obj[key];
  } catch (err) {
    return { [TAG]: 'error', name: 'GetterError', message: String(err && err.message) };
  }
}

function preview(v) {
  try {
    if (Array.isArray(v)) return `Array(${v.length})`;
    if (v instanceof Map) return `Map(${v.size})`;
    if (v instanceof Set) return `Set(${v.size})`;
    const keys = Object.keys(v);
    return `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', …' : ''}}`;
  } catch {
    return 'Object';
  }
}

export function describeElement(el) {
  let desc = el.tagName ? el.tagName.toLowerCase() : 'element';
  if (el.id) desc += `#${el.id}`;
  if (typeof el.className === 'string' && el.className.trim()) {
    desc += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
  }
  return `<${desc}>`;
}
