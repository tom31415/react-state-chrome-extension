// Regression coverage for: the Component tab's tree view, search, and live
// auto-refresh (all against the real extension + real panel UI).
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

test('tree shows every composite component, flattened through the Fragment root', async () => {
  const names = (
    await session.panelPage.evaluate(() =>
      [...document.querySelectorAll('.component-name')].map((el) => el.textContent)
    )
  ).sort();
  // react-redux's own <Provider> IS a real composite component (unlike a raw
  // Context.Provider, which is flattened through) — it shows up here too,
  // just named "Anonymous" since the minified UMD build has no displayName.
  assert.deepEqual(
    names,
    ['Anonymous', 'Anonymous', 'App', 'ClassCounter', 'HookCounter', 'TodoList', 'ThemedBadge'].sort()
  );
});

test('search filters to matches and their ancestors', async () => {
  await session.panelPage.fill('#component-search', 'Hook');
  await session.panelPage.waitForTimeout(100);
  const rows = await treeRowTexts(session.panelPage, '.component-row');
  assert.ok(rows.some((r) => r.includes('HookCounter')));
  assert.ok(!rows.some((r) => r.includes('ClassCounter')), 'non-matching branch hidden');
  assert.ok(!rows.some((r) => r.includes('TodoList')), 'non-matching branch hidden');

  await session.panelPage.fill('#component-search', '');
  await session.panelPage.waitForTimeout(100);
});

test('clicking a tree row selects it and shows the same detail view the picker uses', async () => {
  const rows = await session.panelPage.$$('.component-row');
  let classCounterRow = null;
  for (const r of rows) {
    if ((await r.innerText()).includes('ClassCounter')) {
      classCounterRow = r;
      break;
    }
  }
  await classCounterRow.click();
  await session.settle();

  const header = await session.panelPage.evaluate(
    () => document.querySelector('.component-header h2')?.textContent
  );
  assert.equal(header, '<ClassCounter>');
  const selected = await session.panelPage.evaluate(
    () => !!document.querySelector('.component-row.selected')
  );
  assert.ok(selected, 'the clicked row gets the selected highlight class');
});

test('twisty collapse/expand toggles child row visibility', async () => {
  const before = (await session.panelPage.$$('.component-row')).length;
  const firstTwisty = await session.panelPage.$('.component-row .twisty:not(.twisty-none)');
  await firstTwisty.click();
  await session.panelPage.waitForTimeout(80);
  const collapsed = (await session.panelPage.$$('.component-row')).length;
  assert.ok(collapsed < before, 'collapsing the root hides its descendants');

  const twistyAgain = await session.panelPage.$('.component-row .twisty:not(.twisty-none)');
  await twistyAgain.click();
  await session.panelPage.waitForTimeout(80);
  const reExpanded = (await session.panelPage.$$('.component-row')).length;
  assert.equal(reExpanded, before, 'expanding restores the original row count');
});

test('the tree auto-refreshes on real React commits with no manual action', async () => {
  const before = await session.appPage.evaluate(() => {
    window.__treeMsgCount = 0;
    window.addEventListener('message', (e) => {
      if (e.source === window && e.data?.msg?.type === 'component-tree') window.__treeMsgCount++;
    });
    return window.__treeMsgCount;
  });
  for (let i = 0; i < 8; i++) {
    await (await session.appPage.$('#hook-counter button:has-text("Redux +")')).click({ force: true });
    await session.pump();
    await session.appPage.waitForTimeout(60);
  }
  await session.settle();
  const after = await session.appPage.evaluate(() => window.__treeMsgCount);
  assert.ok(after > before, 'at least one automatic component-tree push happened without a manual rescan/reselect');
});
