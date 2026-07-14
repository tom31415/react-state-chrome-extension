// Regression coverage for: focusing/scoping the component tree to a
// subtree (the truncation-cap escape hatch).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, treeRowTexts } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
  await session.panelPage.click('#tab-component');
  await session.settle();
});

after(async () => {
  await session.close();
});

async function focusRow(page, text) {
  const rows = await page.$$('.component-row');
  for (const row of rows) {
    if ((await row.innerText()).includes(text)) {
      await row.hover();
      await (await row.$('.component-focus-btn')).click();
      return;
    }
  }
  throw new Error(`No row matching "${text}"`);
}

test('focusing a leaf component scopes the tree to just that row', async () => {
  await focusRow(session.panelPage, 'ClassCounter');
  await session.settle();

  const rows = await treeRowTexts(session.panelPage, '.component-row');
  assert.deepEqual(rows, ['ClassCounter class']);

  const barVisible = await session.panelPage.evaluate(
    () => !document.getElementById('component-focus-bar').hidden
  );
  assert.ok(barVisible);
  const label = await session.panelPage.evaluate(
    () => document.getElementById('component-focus-label').textContent
  );
  assert.equal(label, 'Focused on <ClassCounter>');
});

test('search still filters within the focused subtree', async () => {
  await session.panelPage.fill('#component-search', 'ClassCounter');
  await session.panelPage.waitForTimeout(100);
  const rows = await treeRowTexts(session.panelPage, '.component-row');
  assert.deepEqual(rows, ['ClassCounter class']);
  await session.panelPage.fill('#component-search', '');
  await session.panelPage.waitForTimeout(100);
});

test('focus survives the throttled auto-refresh across real React commits', async () => {
  for (let i = 0; i < 6; i++) {
    await (await session.appPage.$('#class-counter button:has-text("Click me")')).click({ force: true });
    await session.pump();
    await session.appPage.waitForTimeout(80);
  }
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.component-row');
  assert.deepEqual(rows, ['ClassCounter class'], 'still scoped, not reverted to the full tree');
});

test('"Show full tree" restores the complete tree and hides the bar', async () => {
  await session.panelPage.click('#component-focus-clear');
  await session.settle();
  const rows = await treeRowTexts(session.panelPage, '.component-row');
  assert.ok(rows.length > 1, 'full tree restored');
  const barHidden = await session.panelPage.evaluate(() => document.getElementById('component-focus-bar').hidden);
  assert.ok(barHidden);
});
