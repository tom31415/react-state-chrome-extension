// Regression coverage for: picking a component on the page highlights the
// matching row in the component tree (expanding a collapsed ancestor if
// needed), rather than the tree and picker being independent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch } from './harness.mjs';

let session;

before(async () => {
  session = await launch();
  await session.panelPage.click('#tab-component');
  await session.settle();
});

after(async () => {
  await session.close();
});

test('picking an already-visible component highlights its tree row', async () => {
  await session.panelPage.click('#pick');
  await session.settle();
  await session.appPage.click('#class-counter h2');
  await session.settle();

  const selectedRows = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.component-row.selected')].map((r) => r.innerText.trim())
  );
  assert.equal(selectedRows.length, 1);
  assert.match(selectedRows[0], /ClassCounter/);
});

test('picking a component behind a collapsed ancestor re-expands it and highlights the row', async () => {
  // Collapse the first "Anonymous" (Provider wrapping HookCounter).
  const rows = await session.panelPage.$$('.component-row');
  for (const r of rows) {
    if ((await r.innerText()).includes('Anonymous')) {
      await (await r.$('.twisty:not(.twisty-none)')).click();
      break;
    }
  }
  await session.panelPage.waitForTimeout(100);
  const hiddenWhileCollapsed = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.component-row')].some((r) => r.innerText.includes('HookCounter'))
  );
  assert.equal(hiddenWhileCollapsed, false, 'HookCounter is hidden behind the collapsed ancestor');

  await session.panelPage.click('#pick');
  await session.settle();
  await session.appPage.click('#hook-counter h2');
  await session.settle();

  const rowsNow = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.component-row')].map((r) => r.innerText.trim())
  );
  assert.ok(rowsNow.some((r) => r.includes('HookCounter')), 'ancestor auto-expanded to reveal the picked row');

  const selected = await session.panelPage.evaluate(() =>
    document.querySelector('.component-row.selected')?.innerText.trim()
  );
  assert.match(selected, /HookCounter/);

  const header = await session.panelPage.evaluate(
    () => document.querySelector('.component-header h2')?.textContent
  );
  assert.equal(header, '<HookCounter>');
});
