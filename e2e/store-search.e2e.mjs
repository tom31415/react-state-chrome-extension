// Regression coverage for: search inside the Stores tab's state tree.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, treeRowTexts } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
});

after(async () => {
  await session.close();
});

test('unfiltered tree shows every key', async () => {
  const keys = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('#store-tree .tree-key')].map((k) => k.textContent)
  );
  assert.deepEqual(keys.sort(), ['count', 'meta', 'state', 'step'].sort());
});

test('search narrows to matching keys and their ancestors', async () => {
  await session.panelPage.fill('#store-search', 'step');
  await session.panelPage.waitForTimeout(100);
  const keys = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('#store-tree .tree-key')].map((k) => k.textContent)
  );
  assert.deepEqual(keys, ['state', 'step']);
});

test('a query with no matches shows the empty message', async () => {
  await session.panelPage.fill('#store-search', 'zzz-nomatch');
  await session.panelPage.waitForTimeout(100);
  const message = await session.panelPage.evaluate(() => document.querySelector('#store-tree .empty')?.textContent);
  assert.equal(message, 'No values match "zzz-nomatch".');
});

test('clearing the search restores the full tree', async () => {
  await session.panelPage.fill('#store-search', '');
  await session.panelPage.waitForTimeout(100);
  const keys = await treeRowTexts(session.panelPage, '#store-tree .tree-key');
  assert.equal(keys.length, 4);
});
