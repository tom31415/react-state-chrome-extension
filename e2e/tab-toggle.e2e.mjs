// Regression coverage for the Stores/Component tab CSS specificity bug: an
// ID-selector display:flex rule on each pane outranked the browser's
// built-in [hidden] { display: none }, so toggling the hidden ATTRIBUTE
// never actually hid either pane.
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

async function paneState(page) {
  return page.evaluate(() => {
    const cs = (el) => getComputedStyle(el).display;
    return {
      stores: cs(document.getElementById('stores-view')),
      component: cs(document.getElementById('component-view')),
    };
  });
}

test('Stores tab is visible and Component tab is hidden by default', async () => {
  const s = await paneState(session.panelPage);
  assert.equal(s.stores, 'flex');
  assert.equal(s.component, 'none');
});

test('clicking Component shows it and hides Stores', async () => {
  await session.panelPage.click('#tab-component');
  await session.panelPage.waitForTimeout(50);
  const s = await paneState(session.panelPage);
  assert.equal(s.stores, 'none');
  assert.equal(s.component, 'flex');
});

test('clicking Stores again reverses it', async () => {
  await session.panelPage.click('#tab-stores');
  await session.panelPage.waitForTimeout(50);
  const s = await paneState(session.panelPage);
  assert.equal(s.stores, 'flex');
  assert.equal(s.component, 'none');
});
