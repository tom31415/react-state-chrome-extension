// Regression coverage for: a pure service-worker/port reconnect
// ('bridge-ready') must NOT blank the UI. 'bridge-ready' fires whenever
// content.js's own port to the service worker reconnects — the MV3
// service worker idle-suspends routinely, entirely independent of the
// page or its stores — so the still-intact agent should just be asked to
// re-sync, not treated as if everything needs to be torn down.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
});

after(async () => {
  await session.close();
});

test('a pure bridge-ready reconnect never blanks the store list', async () => {
  const before = await session.panelPage.evaluate(() => document.querySelectorAll('.store-item').length);
  assert.equal(before, 2);

  await session.panelPage.evaluate(() => window.__feedPanel({ type: 'bridge-ready' }));
  const immediatelyAfter = await session.panelPage.evaluate(() => ({
    count: document.querySelectorAll('.store-item').length,
    empty: document.querySelector('#store-list .empty')?.textContent || null,
  }));
  assert.equal(immediatelyAfter.count, 2, 'no flash to zero, even for one frame');
  assert.equal(immediatelyAfter.empty, null);

  await session.settle();
  const after = await session.panelPage.evaluate(() => document.querySelectorAll('.store-item').length);
  assert.equal(after, 2);
});

test('a genuine agent-ready still performs its full reset', async () => {
  await session.panelPage.evaluate(() => window.__feedPanel({ type: 'agent-ready' }));
  const immediatelyAfter = await session.panelPage.evaluate(
    () => document.querySelector('#store-list .empty')?.textContent || null
  );
  assert.match(immediatelyAfter || '', /No Redux stores found/, 'a real page-agent reset legitimately clears first');

  await session.settle();
  const after = await session.panelPage.evaluate(() => document.querySelectorAll('.store-item').length);
  assert.equal(after, 2, 'and repopulates once the fresh data arrives');
});
