// Visual element picker: highlights the hovered element with the name of its
// owning React component; click selects it, Escape cancels. All mouse events
// are captured and suppressed while picking so the page doesn't react.

import { getReactRefFromNode, nearestComposite, describeComponent } from './fibers.js';
import { showHighlight, hideHighlight } from './overlay.js';

const SUPPRESSED_EVENTS = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'];

export function createPicker({ onPick, onCancel }) {
  let active = false;
  let current = null; // { comp, node, name }

  function resolve(el) {
    const ref = getReactRefFromNode(el);
    if (!ref) return null;
    const comp = nearestComposite(ref);
    if (!comp) return null;
    let name = 'Component';
    try {
      name = describeComponent(comp).name;
    } catch {
      // fall back to the generic label
    }
    return { comp, node: el, name };
  }

  function onMove(e) {
    const t = e.target;
    if (!(t instanceof Element) || t.hasAttribute('data-rsi-overlay')) return;
    current = resolve(t);
    // Chrome-inspector-style label: element, dimensions, owning component.
    const rect = t.getBoundingClientRect();
    const dims = `${round1(rect.width)} × ${round1(rect.height)}`;
    let tag = t.tagName.toLowerCase();
    if (t.id) tag += `#${t.id}`;
    else if (typeof t.className === 'string' && t.className.trim()) {
      tag += '.' + t.className.trim().split(/\s+/)[0];
    }
    showHighlight(
      t,
      current ? `<${current.name}>  ${tag} | ${dims}` : `${tag} | ${dims}  (not a React element)`
    );
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function onClick(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const picked = current;
    stop();
    if (picked) onPick(picked.comp, picked.node);
    else onCancel('No React component under the cursor.');
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      stop();
      onCancel();
    }
  }

  function suppress(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  function start() {
    if (active) return;
    active = true;
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey, true);
    for (const ev of SUPPRESSED_EVENTS) window.addEventListener(ev, suppress, true);
    if (document.documentElement) document.documentElement.style.cursor = 'crosshair';
  }

  function stop() {
    if (!active) return;
    active = false;
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKey, true);
    for (const ev of SUPPRESSED_EVENTS) window.removeEventListener(ev, suppress, true);
    if (document.documentElement) document.documentElement.style.cursor = '';
    hideHighlight();
    current = null;
  }

  return {
    start,
    stop,
    isActive: () => active,
  };
}
