// Regression coverage for: copy-value/copy-path buttons on tree rows.
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

test('copy value and copy path write the expected text to the clipboard', async () => {
  const rows = await session.panelPage.$$('#store-tree .tree-row');
  let countRow = null;
  for (const r of rows) {
    if ((await r.innerText()).includes('count')) {
      countRow = r;
      break;
    }
  }
  await countRow.hover();
  const buttons = await countRow.$$('.tree-copy');
  assert.equal(buttons.length, 2, 'copy-value and copy-path buttons both present');
  await buttons[0].click();
  await buttons[1].click();

  const clipboard = await session.panelPage.evaluate(() => window.__clipboard);
  assert.deepEqual(clipboard, ['0', 'state.count']);

  const toasts = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => t.textContent)
  );
  assert.ok(toasts.every((t) => t === 'Copied to clipboard.'));
});
