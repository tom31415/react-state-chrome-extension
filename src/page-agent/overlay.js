// In-page highlight box with a name label. Pure inline styles; pointer-events
// disabled so it never intercepts the picker's own mouse events.

let container = null;
let labelEl = null;

function ensure() {
  if (container && container.isConnected) return container;
  container = document.createElement('div');
  container.setAttribute('data-rsi-overlay', '');
  Object.assign(container.style, {
    position: 'fixed',
    zIndex: '2147483646',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    border: '2px solid #4a9eff',
    background: 'rgba(74, 158, 255, 0.15)',
    borderRadius: '2px',
    display: 'none',
  });
  labelEl = document.createElement('div');
  Object.assign(labelEl.style, {
    position: 'absolute',
    top: '-24px',
    left: '-2px',
    padding: '2px 6px',
    background: '#1a1a2e',
    color: '#4a9eff',
    font: '11px/1.5 monospace',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    maxWidth: '60vw',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  container.appendChild(labelEl);
  (document.body || document.documentElement).appendChild(container);
  return container;
}

export function showHighlight(node, text) {
  if (!node || typeof node.getBoundingClientRect !== 'function') return;
  const box = ensure();
  const rect = node.getBoundingClientRect();
  box.style.display = 'block';
  box.style.left = `${rect.left}px`;
  box.style.top = `${rect.top}px`;
  box.style.width = `${Math.max(rect.width, 2)}px`;
  box.style.height = `${Math.max(rect.height, 2)}px`;
  labelEl.textContent = text || '';
  labelEl.style.display = text ? 'block' : 'none';
  // Keep the label on-screen for elements at the top edge.
  labelEl.style.top = rect.top < 30 ? '100%' : '-24px';
}

export function hideHighlight() {
  if (container) container.style.display = 'none';
}

// "Highlight updates" flash — a transient box per re-rendered component,
// independent of the single persistent highlight box above since several
// components can flash in the same commit. Each box removes itself.
const FLASH_MS = 400;

export function flashUpdate(node) {
  if (!node || typeof node.getBoundingClientRect !== 'function') return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const box = document.createElement('div');
  box.setAttribute('data-rsi-overlay', '');
  Object.assign(box.style, {
    position: 'fixed',
    zIndex: '2147483647',
    pointerEvents: 'none',
    boxSizing: 'border-box',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${Math.max(rect.width, 2)}px`,
    height: `${Math.max(rect.height, 2)}px`,
    border: '2px solid #f0b400',
    background: 'rgba(240, 180, 0, 0.25)',
    borderRadius: '2px',
    transition: `opacity ${FLASH_MS}ms ease-out`,
    opacity: '1',
  });
  (document.body || document.documentElement).appendChild(box);
  requestAnimationFrame(() => {
    box.style.opacity = '0';
  });
  setTimeout(() => box.remove(), FLASH_MS + 100);
}
