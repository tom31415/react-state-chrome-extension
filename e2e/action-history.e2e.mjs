// Regression coverage for: the Redux action log / time-travel feature —
// history recorded from the moment a store is found (not just once the
// panel asks), live incremental updates, and jump-to-action genuinely
// restoring the running app's state.
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

async function reduxPlus() {
  await (await session.appPage.$('#hook-counter button:has-text("Redux +")')).click({ force: true });
  await session.pump();
  await session.appPage.waitForTimeout(60);
}

test('history was recording before the panel ever asked for it', async () => {
  for (let i = 0; i < 3; i++) await reduxPlus();
  await session.settle();
  const countText = await session.appPage.evaluate(() => document.querySelector('#hook-counter p').textContent);
  assert.match(countText, /Redux count: 3/);

  await session.panelPage.click('#store-history-toggle');
  await session.settle();
  const rows = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.history-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim())
  );
  assert.deepEqual(rows, ['#1 increment', '#2 increment', '#3 increment']);
});

test('actions dispatched while history is open push live incremental updates', async () => {
  await reduxPlus();
  await reduxPlus();
  await session.settle();
  const rows = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.history-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim())
  );
  assert.deepEqual(rows, ['#1 increment', '#2 increment', '#3 increment', '#4 increment', '#5 increment']);
});

test('clicking a past action genuinely jumps the running app back to that state', async () => {
  const rows = await session.panelPage.$$('.history-row');
  await rows[0].click(); // action #1, when count was 1
  await session.settle();
  const countText = await session.appPage.evaluate(() => document.querySelector('#hook-counter p').textContent);
  assert.match(countText, /Redux count: 1/);

  const toast = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('.toast')].map((t) => t.textContent).pop()
  );
  assert.equal(toast, 'State updated.', 'tier-1 store: jump is persistent, not the ephemeral warning');
});

test('Clear resets the history list', async () => {
  await session.panelPage.click('#store-history-clear');
  await session.settle();
  const rowCount = await session.panelPage.evaluate(() => document.querySelectorAll('.history-row').length);
  assert.equal(rowCount, 0);
  const message = await session.panelPage.evaluate(
    () => document.querySelector('#store-history-list .empty')?.textContent
  );
  assert.equal(message, 'No actions recorded yet.');
});
