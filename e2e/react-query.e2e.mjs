// Regression coverage for React Query support: detection via
// QueryClientProvider's client prop, the live queries/mutations list,
// per-item detail with data editing, and the four query actions
// (Refetch/Invalidate/Reset/Remove) plus mutation Remove.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, treeRowTexts, clickRowContaining } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
  await session.panelPage.click('#tab-queries');
  await session.settle();
});

after(async () => {
  await session.close();
});

test('the demo QueryClient is detected and its query is listed', async () => {
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.ok(
    rows.some((r) => r.includes('user') && r.includes('"1"')),
    `expected a user query row, got: ${JSON.stringify(rows)}`
  );
});

test('the query is no longer "fetching" once the fake fetch has resolved', async () => {
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  const userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh|stale/, `expected a settled badge, got: ${userRow}`);
});

test('selecting the query shows its data in the detail pane', async () => {
  await clickRowContaining(session.panelPage, '.query-row', '"1"');
  await session.settle();
  const dataText = await session.panelPage.evaluate(() => document.querySelector('#query-detail')?.innerText || '');
  assert.match(dataText, /Ada Lovelace/);
});

test('editing the query data persists and is reflected by the running app', async () => {
  const rows = await session.panelPage.$$('#query-detail .tree-row');
  let row = null;
  for (const r of rows) {
    if ((await r.innerText()).includes('name')) {
      row = r;
      break;
    }
  }
  await row.dblclick();
  await session.panelPage.waitForTimeout(80);
  const input = await session.panelPage.$('input.tree-edit');
  await input.fill('"Edited Name"');
  await input.press('Enter');
  await session.settle();
  const appText = await session.appPage.evaluate(() => document.querySelector('#user-query p').textContent);
  assert.match(appText, /Edited Name/);
});

test('Refetch overwrites the local edit once the fake fetch resolves again', async () => {
  await session.panelPage.click('#query-detail button:has-text("Refetch")');
  await session.panelPage.waitForTimeout(250); // longer than the demo's fake 150ms latency
  await session.settle();
  const appText = await session.appPage.evaluate(() => document.querySelector('#user-query p').textContent);
  assert.match(appText, /Ada Lovelace/, "the real queryFn's result wins back over the edit");
});

test("a live Refetch update preserves the data tree's expansion state (create-once, update-via-setData)", async () => {
  // Re-select the user query fresh (clicking a query row always re-fires
  // onSelect, even when it's already selected — see queryList.js) so we
  // start from a known, default-expanded tree: the root node open, its two
  // leaf fields (id/name) showing.
  await clickRowContaining(session.panelPage, '.query-row', '"1"');
  await session.settle();

  const beforeCollapse = await treeRowTexts(session.panelPage, '#query-detail .tree-row');
  assert.ok(
    beforeCollapse.length >= 3,
    `expected the root row plus its id/name leaves, got: ${JSON.stringify(beforeCollapse)}`
  );

  // Collapse the root — since the tree starts fully expanded by default,
  // this is a real, observable change to expansion state (hides the leaves).
  const rootTwisty = await session.panelPage.$('#query-detail .tree-row .twisty:not(.twisty-none)');
  assert.ok(rootTwisty, 'expected the root row to have a twisty (it is a container)');
  await rootTwisty.click();
  await session.panelPage.waitForTimeout(50);

  const afterCollapse = await treeRowTexts(session.panelPage, '#query-detail .tree-row');
  assert.equal(afterCollapse.length, 1, 'collapsing the root should hide its child rows');

  // Trigger a live update to the SAME query without changing selection —
  // renderQueryDetail() must update the existing tree via setData rather
  // than tearing it down and recreating it, or the tree's internal
  // expanded-node Set would reset and the root would default back open.
  await session.panelPage.click('#query-detail button:has-text("Refetch")');
  await session.panelPage.waitForTimeout(250); // longer than the demo's fake 150ms latency
  await session.settle();

  const afterRefetch = await treeRowTexts(session.panelPage, '#query-detail .tree-row');
  assert.equal(
    afterRefetch.length,
    1,
    'the root should still be collapsed after a same-identity live update, proving the tree was updated in place'
  );
});

test('Reset returns the query to a fresh, refetched state', async () => {
  await session.panelPage.click('#query-detail button:has-text("Reset")');
  await session.panelPage.waitForTimeout(250);
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  const userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh/);
});

test('Invalidate triggers an immediate refetch (transient fetching), then resolves back to fresh', async () => {
  await session.panelPage.click('#query-detail button:has-text("Invalidate")');
  await session.settle(3, 40); // short window: before the demo's 150ms fake latency resolves
  let rows = await treeRowTexts(session.panelPage, '.query-row');
  let userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fetching/, 'invalidating an active query triggers an immediate refetch');

  await session.panelPage.waitForTimeout(250);
  await session.settle();
  rows = await treeRowTexts(session.panelPage, '.query-row');
  userRow = rows.find((r) => r.includes('"1"'));
  assert.match(userRow, /fresh/);
});

test('switching to a second user creates a second query row', async () => {
  await session.appPage.click('#user-query button:has-text("Switch user")');
  await session.panelPage.waitForTimeout(250);
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.filter((r) => r.includes('user')).length, 2, `expected 2 user query rows, got: ${JSON.stringify(rows)}`);
});

test('Remove deletes the query row from the list', async () => {
  await clickRowContaining(session.panelPage, '.query-row', '"2"');
  await session.settle();
  await session.panelPage.click('#query-detail button:has-text("Remove")');
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.filter((r) => r.includes('"2"')).length, 0);
});

test('firing a mutation lists it under the Mutations toggle, and Remove clears it', async () => {
  await session.panelPage.click('#query-kind-mutations');
  await session.appPage.click('#comment-mutation button:has-text("Submit comment")');
  await session.panelPage.waitForTimeout(200);
  await session.settle();
  let rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.ok(rows.some((r) => r.includes('Mutation #')), `expected a mutation row, got: ${JSON.stringify(rows)}`);

  await clickRowContaining(session.panelPage, '.query-row', 'Mutation');
  await session.settle();
  await session.panelPage.click('#query-detail button:has-text("Remove")');
  await session.settle();
  rows = await treeRowTexts(session.panelPage, '.query-row');
  assert.equal(rows.length, 0);
});
