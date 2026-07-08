// Content bridge — ISOLATED world. Relays messages between the page agent
// (window.postMessage) and the service worker (runtime port), reconnecting
// if the service worker was suspended.

let port = null;

function ensurePort() {
  if (port) return port;
  port = chrome.runtime.connect({ name: 'rri-content' });
  port.onMessage.addListener((msg) => {
    window.postMessage({ __rri: 'to-agent', msg }, '*');
  });
  port.onDisconnect.addListener(() => {
    port = null;
  });
  return port;
}

window.addEventListener('message', (event) => {
  if (event.source !== window || !event.data || event.data.__rri !== 'to-panel') return;
  try {
    ensurePort().postMessage(event.data.msg);
  } catch {
    port = null;
    try {
      ensurePort().postMessage(event.data.msg);
    } catch {
      // extension context invalidated (e.g. extension was reloaded)
    }
  }
});

ensurePort();
