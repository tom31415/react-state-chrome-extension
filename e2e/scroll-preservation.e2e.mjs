// Regression coverage for: scroll position in the store state tree
// surviving both ordinary re-renders and the extension's own MV3
// reconnect cycle. The real bug was two-layered — a naive fix for the
// first layer alone (tree.js clearing its container on every render)
// looked plausible but did NOT fix the reported symptom; the actual
// trigger is the 'agent-ready' full reset briefly showing "Waiting for
// state…", which collapses the pane to one line and clamps any restore
// attempt made at that instant back to 0. These tests pin BOTH layers.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
  await session.panelPage.setViewportSize({ width: 500, height: 180 });
});

after(async () => {
  await session.close();
});

async function expandRow(page, text) {
  const rows = await page.$$('#store-tree .tree-row');
  for (const r of rows) {
    if ((await r.innerText()).includes(text)) {
      await (await r.$('.twisty:not(.twisty-none)')).click();
      return;
    }
  }
  throw new Error(`row "${text}" not found`);
}

test('scrollTop survives an ordinary per-dispatch state push', async () => {
  await expandRow(session.panelPage, 'meta');
  await session.panelPage.waitForTimeout(100);
  await session.panelPage.evaluate(() => {
    const el = document.getElementById('store-tree');
    el.scrollTop = el.scrollHeight;
  });
  const before = await session.panelPage.evaluate(() => document.getElementById('store-tree').scrollTop);
  assert.ok(before > 0, 'the pane is actually scrolled (viewport is short enough to overflow)');

  await (await session.appPage.$('#hook-counter button:has-text("Redux +")')).click({ force: true });
  await session.settle();

  const after = await session.panelPage.evaluate(() => document.getElementById('store-tree').scrollTop);
  assert.equal(after, before);
});

test('scrollTop survives the agent-ready reconnect cycle (the reported bug)', async () => {
  const before = await session.panelPage.evaluate(() => document.getElementById('store-tree').scrollTop);
  assert.ok(before > 0);

  await session.panelPage.evaluate(() => window.__feedPanel({ type: 'agent-ready' }));
  const duringReset = await session.panelPage.evaluate(() => ({
    scrollTop: document.getElementById('store-tree').scrollTop,
    text: document.getElementById('store-tree').textContent,
  }));
  assert.equal(duringReset.text, 'Waiting for state…', 'the transient reset state really is showing');
  assert.equal(duringReset.scrollTop, 0, 'expected and harmless: nothing to scroll into for that instant');

  await session.settle();
  const after = await session.panelPage.evaluate(() => document.getElementById('store-tree').scrollTop);
  assert.equal(after, before, 'the lasting position is restored once real content rebuilds');
});
