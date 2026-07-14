// Regression coverage for: React/store detection against the real
// extension, the visual Element Selector, and the highlight overlay.
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

test('environment reports React version and both demo stores', async () => {
  const { panelPage, settle } = session;
  await settle();

  const env = await panelPage.evaluate(() => document.getElementById('env').textContent);
  assert.match(env, /React/);

  const storeCount = await panelPage.evaluate(() => document.querySelectorAll('.store-item').length);
  assert.equal(storeCount, 2, 'tier-1 counter store and tier-3 todos store both discovered');
});

test('hovering while picking shows a Chrome-inspector-style overlay label', async () => {
  const { appPage, panelPage, settle } = session;
  await panelPage.click('#pick');
  await settle();
  await appPage.hover('#class-counter p');
  await appPage.waitForTimeout(150);

  const overlay = await appPage.evaluate(() => {
    const el = document.querySelector('[data-rri-overlay]');
    return el ? { visible: el.style.display !== 'none', label: el.textContent } : null;
  });
  assert.ok(overlay, 'overlay element exists');
  assert.ok(overlay.visible, 'overlay is visible while hovering during pick mode');
  assert.match(overlay.label, /<ClassCounter>/);
  assert.match(overlay.label, /×/, 'label includes element dimensions like the real Chrome inspector');
});

test('clicking while picking selects the component and shows its detail view', async () => {
  const { appPage, panelPage, settle } = session;
  await appPage.click('#class-counter h2'); // still in pick mode from the previous test
  await settle();

  const header = await panelPage.evaluate(() => document.querySelector('.component-header h2')?.textContent);
  assert.equal(header, '<ClassCounter>');

  const picking = await panelPage.evaluate(() => document.getElementById('pick').classList.contains('active'));
  assert.equal(picking, false, 'pick mode ends after a successful click');
});
