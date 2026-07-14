// Regression coverage for: live prop editing on class components (React
// dev builds freeze element.props, so this must reassign the reference
// rather than mutate in place), and read-only enforcement for function
// components.
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

async function editRow(page, label, value) {
  const rows = await page.$$('.tree-row');
  let row = null;
  for (const r of rows) {
    if ((await r.innerText()).includes(label)) {
      row = r;
      break;
    }
  }
  await row.dblclick();
  await page.waitForTimeout(80);
  const input = await page.$('input.tree-edit');
  await input.fill(value);
  await input.press('Enter');
  await page.waitForTimeout(150);
}

test('editing a class component prop updates the live running app', async () => {
  const { appPage, panelPage, settle } = session;
  await panelPage.click('#pick');
  await settle();
  await appPage.click('#class-counter h2');
  await settle();

  const propsTitle = await panelPage.evaluate(() => {
    const h3s = [...document.querySelectorAll('#component-detail h3')];
    return h3s.find((h) => h.textContent.startsWith('Props'))?.textContent;
  });
  assert.equal(propsTitle, 'Props (editable)');

  await editRow(panelPage, 'label', '"EDITED LIVE"');
  await settle();

  const headerText = await appPage.evaluate(() => document.querySelector('#class-counter h2').textContent);
  assert.equal(headerText, 'ClassCounter (EDITED LIVE)');
});

test('a second edit on a different path still commits correctly', async () => {
  const { appPage, panelPage, settle } = session;
  await editRow(panelPage, 'label', '"second edit"');
  await settle();
  const headerText = await appPage.evaluate(() => document.querySelector('#class-counter h2').textContent);
  assert.equal(headerText, 'ClassCounter (second edit)');
});

test('function component props stay read-only (no editable affordance)', async () => {
  const { appPage, panelPage, settle } = session;
  await panelPage.click('#pick');
  await settle();
  await appPage.click('#hook-counter h2');
  await settle();

  const propsTitle = await panelPage.evaluate(() => {
    const h3s = [...document.querySelectorAll('#component-detail h3')];
    return h3s.find((h) => h.textContent.startsWith('Props'))?.textContent;
  });
  assert.equal(propsTitle, 'Props', 'no "(editable)" suffix for a function component');

  const editableClass = await panelPage.evaluate(() => {
    const rows = [...document.querySelectorAll('#component-detail .tree-row')];
    const row = rows.find((r) => r.innerText.includes('label'));
    return row?.className;
  });
  assert.equal(editableClass, 'tree-row', 'no "editable" class, no dblclick handler attached');
});
