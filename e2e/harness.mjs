// Shared harness for the browser-driven regression suite: serves the repo
// over HTTP, loads the REAL built extension into a real (headless)
// Chromium via playwright-core, and bridges messages between the demo
// page (the actual page agent) and a plain page loading panel.html with a
// mocked chrome.devtools/chrome.runtime — standing in for the extension's
// content-script/service-worker routing, exactly as verified by hand
// throughout this project's development.
//
// Every e2e test file calls launch() once (via node:test's `before`) and
// close() once (via `after`); within a file, tests share one browser
// session so a flow (pick -> edit -> verify) can span multiple test()
// blocks, but each FILE gets its own fresh browser + ephemeral port so
// files remain independent even if node:test runs them concurrently.

import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(req.url.split('?')[0]);
        const filePath = join(REPO_ROOT, path);
        const body = await readFile(filePath);
        res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Launches the real extension (from distPath, default <repo>/dist — run
// `npm run build` first) into headless Chromium, opens the demo app page
// and a panel page (chrome API mocked), and returns a bridged, ready-to-use
// session.
export async function launch({ distPath = join(REPO_ROOT, 'dist'), demoPath = '/demo/agent-test.html' } = {}) {
  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  const context = browser.contexts()[0] || (await browser.newContext());
  const appPage = await context.newPage();
  const panelPage = await context.newPage();

  await appPage.goto(`${base}${demoPath}`, { waitUntil: 'load' });
  await appPage.waitForTimeout(300); // let the page agent finish its own setup

  await appPage.evaluate(() => {
    window.__outbox = [];
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data && e.data.__rsi === 'to-panel') window.__outbox.push(e.data.msg);
    });
  });

  // First navigation to panel.html throws before the chrome mock exists
  // (matches how a real devtools page only gets one) — that's expected and
  // harmless; the reload below is what actually matters.
  await panelPage.goto(`${base}/dist/panel/panel.html`, { waitUntil: 'load' }).catch(() => {});
  await panelPage.addInitScript(() => {
    window.__sentToAgentQueue = [];
    window.__clipboard = [];
    let listener = null;
    const fakePort = {
      postMessage: (msg) => window.__sentToAgentQueue.push(msg),
      onMessage: { addListener: (fn) => (listener = fn) },
      onDisconnect: { addListener: () => {} },
    };
    window.__feedPanel = (msg) => listener && listener(msg);
    window.chrome = {
      devtools: { inspectedWindow: { tabId: 1 } },
      runtime: { connect: () => fakePort },
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text) => { window.__clipboard.push(text); return Promise.resolve(); } },
      configurable: true,
    });
  });
  await panelPage.reload({ waitUntil: 'load' });
  await panelPage.waitForTimeout(150);

  // One relay hop: drains whatever the agent has queued for the panel and
  // feeds it in, then drains whatever the panel queued for the agent and
  // posts it in. A full round-trip (panel asks -> agent answers) needs
  // several of these, since each hop is a separate window.postMessage tick.
  async function pump() {
    const toPanel = await appPage.evaluate(() => {
      const out = window.__outbox || [];
      window.__outbox = [];
      return out;
    });
    for (const msg of toPanel) await panelPage.evaluate((m) => window.__feedPanel(m), msg);
    const toAgent = await panelPage.evaluate(() => {
      const out = window.__sentToAgentQueue;
      window.__sentToAgentQueue = [];
      return out;
    });
    for (const msg of toAgent) {
      await appPage.evaluate((m) => window.postMessage({ __rsi: 'to-agent', msg: m }, '*'), msg);
    }
  }

  async function settle(rounds = 6, waitMs = 100) {
    for (let i = 0; i < rounds; i++) {
      await pump();
      await appPage.waitForTimeout(waitMs);
    }
  }

  await settle();

  async function close() {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  return { browser, context, appPage, panelPage, base, pump, settle, close };
}

// Small DOM convenience helpers reused across test files.

export async function treeRowTexts(page, selector) {
  return page.evaluate(
    (sel) => [...document.querySelectorAll(sel)].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
    selector
  );
}

export async function clickRowContaining(page, selector, text) {
  const rows = await page.$$(selector);
  for (const row of rows) {
    if ((await row.innerText()).includes(text)) {
      await row.click();
      return row;
    }
  }
  throw new Error(`No row matching "${text}" found for selector "${selector}"`);
}
