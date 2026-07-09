// Content bridge — ISOLATED world. Relays messages between the page agent
// (window.postMessage) and the service worker (runtime port).
//
// MV3 lifecycle handling:
//  - the service worker can be terminated at any idle moment, killing the
//    port: reconnect eagerly and announce `bridge-ready` upward so an open
//    panel re-inits, and pessimistically tell the agent the panel is gone
//    (a live panel reactivates it via `init`).
//  - prerendered documents must not connect (they would clobber the active
//    tab's routing): wait for activation.

let port = null;
let invalidated = false; // extension was reloaded/removed; context is dead

function connectPort(announce) {
  if (invalidated || port) return port;
  try {
    port = chrome.runtime.connect({ name: 'rri-content' });
  } catch {
    invalidated = true;
    return null;
  }
  port.onMessage.addListener((msg) => {
    window.postMessage({ __rri: 'to-agent', msg }, '*');
  });
  port.onDisconnect.addListener(() => {
    port = null;
    if (chrome.runtime.lastError) {
      // read to silence "Unchecked runtime.lastError"
    }
    // Assume no panel until one re-inits — stops the agent serializing state
    // on every dispatch for nobody.
    window.postMessage({ __rri: 'to-agent', msg: { type: 'panel-disconnected' } }, '*');
    setTimeout(() => connectPort(true), 200);
  });
  if (announce) {
    // Routed to any open panel, which responds by re-sending `init`.
    try {
      port.postMessage({ type: 'bridge-ready' });
    } catch {
      port = null;
    }
  }
  return port;
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.__rri !== 'to-panel') return;
  const p = connectPort(false);
  if (!p) return;
  try {
    p.postMessage(event.data.msg);
  } catch {
    port = null;
    const retry = connectPort(true);
    if (retry) {
      try {
        retry.postMessage(event.data.msg);
      } catch {
        port = null;
      }
    }
  }
});

if (document.prerendering) {
  document.addEventListener('prerenderingchange', () => connectPort(false), { once: true });
} else {
  connectPort(false);
}
