// Regression coverage for: showing consumed React Context values in the
// component detail view — verified against BOTH a purpose-built demo
// context (ThemedBadge) and react-redux's own internal context usage
// (HookCounter's useSelector/useDispatch), since the extraction logic must
// generalize to any library, not just a hand-built test case.
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

async function pickOnPage(session, selector) {
  await session.panelPage.click('#pick');
  await session.settle();
  await session.appPage.click(selector);
  await session.settle();
}

test('a component using useContext shows its Context section with the real value', async () => {
  await pickOnPage(session, '#themed-badge');
  const title = await session.panelPage.evaluate(() => {
    const h3s = [...document.querySelectorAll('#component-detail h3')];
    return h3s.find((h) => h.textContent === 'Context')?.textContent;
  });
  assert.equal(title, 'Context');
  const row = await session.panelPage.evaluate(() => {
    const rows = [...document.querySelectorAll('#component-detail .tree-row')];
    return rows.find((r) => r.innerText.includes('dark'))?.innerText;
  });
  assert.match(row, /dark/);
});

test("react-redux's own internal context usage is surfaced with no special-casing", async () => {
  await pickOnPage(session, '#hook-counter h2');
  const contextRows = await session.panelPage.evaluate(() => {
    const rows = [...document.querySelectorAll('#component-detail .tree-row')];
    return rows.filter((r) => /Context \d/.test(r.innerText)).map((r) => r.innerText.trim());
  });
  assert.equal(contextRows.length, 2, 'useSelector and useDispatch each consume a context dependency');
});

test('a component with no context dependencies shows no Context section', async () => {
  await pickOnPage(session, '#class-counter h2');
  const hasSection = await session.panelPage.evaluate(() =>
    [...document.querySelectorAll('#component-detail h3')].some((h) => h.textContent === 'Context')
  );
  assert.equal(hasSection, false);
});
