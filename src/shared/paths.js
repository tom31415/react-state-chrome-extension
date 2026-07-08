// Path-based immutable reads/writes over plain objects and arrays.
// A path is an array of string keys; numeric strings index into arrays.

export function isPlainObject(v) {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function getIn(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[key];
  }
  return cur;
}

// Returns a new root with `value` at `path`; every container along the path is
// shallow-copied. Only plain objects and arrays may appear on the path.
export function setIn(obj, path, value) {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid array index "${key}"`);
    }
    const copy = obj.slice();
    copy[index] = setIn(obj[index], rest, value);
    return copy;
  }
  if (isPlainObject(obj)) {
    return { ...obj, [key]: setIn(obj[key], rest, value) };
  }
  throw new Error(
    `Cannot set "${key}": parent is ${obj === null ? 'null' : typeof obj} (only plain objects/arrays are editable)`
  );
}
