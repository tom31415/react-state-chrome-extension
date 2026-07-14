// Regression coverage for: the opt-in "Highlight updates" flash-on-render
// toggle (React DevTools' iconic feature, page-side only, no panel
// round-trip).
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

async function clickMe() {
  await (await session.appPage.$('#class-counter button:has-text("Click me")')).click({ force: true });
}

test('no flash before the toggle is enabled', async () => {
  await clickMe();
  await session.appPage.waitForTimeout(80);
  const count = await session.appPage.evaluate(() => document.querySelectorAll('[data-rri-overlay]').length);
  assert.equal(count, 0);
});

test('enabling the toggle flashes re-rendered components on the page', async () => {
  await session.panelPage.click('#highlight-updates');
  await session.settle();
  const active = await session.panelPage.evaluate(() =>
    document.getElementById('highlight-updates').classList.contains('active')
  );
  assert.ok(active);

  await clickMe();
  const overlays = await session.appPage.evaluate(() =>
    [...document.querySelectorAll('[data-rri-overlay]')].map((el) => el.getBoundingClientRect().width > 0)
  );
  assert.ok(overlays.length > 0, 'at least one component flashed');
  assert.ok(overlays.every(Boolean), 'every flash box has real dimensions');

  await session.appPage.waitForTimeout(700); // past the fade + cleanup timeout
  const afterFade = await session.appPage.evaluate(() => document.querySelectorAll('[data-rri-overlay]').length);
  assert.equal(afterFade, 0, 'flash boxes remove themselves');
});

test('disabling the toggle stops the flash', async () => {
  await session.panelPage.click('#highlight-updates');
  await session.settle();
  await clickMe();
  await session.appPage.waitForTimeout(80);
  const count = await session.appPage.evaluate(() => document.querySelectorAll('[data-rri-overlay]').length);
  assert.equal(count, 0);
});
