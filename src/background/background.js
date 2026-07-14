// Service worker — routes messages between DevTools panels and content
// scripts, keyed by tab id. Holds no other state.

const contentPorts = new Map(); // tabId -> port
const panelPorts = new Map(); // tabId -> Set<port>

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'rsi-content') {
    const tabId = port.sender && port.sender.tab && port.sender.tab.id;
    if (tabId == null) return;
    contentPorts.set(tabId, port);
    port.onMessage.addListener((msg) => {
      const panels = panelPorts.get(tabId);
      if (panels) for (const p of panels) p.postMessage(msg);
    });
    port.onDisconnect.addListener(() => {
      // Read to silence "Unchecked runtime.lastError" — Chrome sets this
      // whenever a port is torn down abnormally (e.g. the page's tab is
      // moved into the back/forward cache), and warns if nobody reads it.
      void chrome.runtime.lastError;
      if (contentPorts.get(tabId) === port) contentPorts.delete(tabId);
    });
  } else if (port.name === 'rsi-panel') {
    let tabId = null;
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'panel-init') {
        tabId = msg.tabId;
        if (!panelPorts.has(tabId)) panelPorts.set(tabId, new Set());
        panelPorts.get(tabId).add(port);
        return;
      }
      if (tabId == null) return;
      const content = contentPorts.get(tabId);
      if (content) content.postMessage(msg);
      else port.postMessage({ type: 'error', message: 'Page is not reachable — reload the tab.' });
    });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // see comment on the 'rsi-content' listener above
      if (tabId == null) return;
      const panels = panelPorts.get(tabId);
      if (panels) {
        panels.delete(port);
        if (panels.size === 0) {
          panelPorts.delete(tabId);
          const content = contentPorts.get(tabId);
          if (content) content.postMessage({ type: 'panel-disconnected' });
        }
      }
    });
  }
});
