// End-to-end smoke test: drives the built app in Chromium using the browser's
// private file system (?storage=opfs) in place of a picked folder.
// Run with: npm run e2e   (screenshots land in test-results/)
import { preview } from 'vite';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const base = 'http://localhost:4179/?storage=opfs';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
mkdirSync('test-results', { recursive: true });

let failed = false;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed = true; console.log(`  ✗ ${name}\n    ${e.message.split('\n')[0]}`); await page.screenshot({ path: 'test-results/failure.png' }); throw e; }
};
const expectText = async (locator, text) => {
  await locator.filter({ hasText: text }).first().waitFor({ timeout: 4000 });
};

try {
  await page.goto(base);

  await step('opens test storage and starts with demo data', async () => {
    await page.getByRole('button', { name: 'Use test storage' }).click();
    await page.getByRole('button', { name: 'Start with demo data' }).click();
    await expectText(page.locator('.client-item'), 'Northwind Health');
    await page.locator('.tl-tile.selected').waitFor();
    await page.screenshot({ path: 'test-results/demo.png' });
  });

  await step('adds a client', async () => {
    await page.getByRole('button', { name: 'New client' }).click();
    await page.getByPlaceholder('Client name, then Enter').fill('Test Co');
    await page.keyboard.press('Enter');
    await expectText(page.locator('.client-name'), 'Test Co');
  });

  await step('sets planned-through with a broad date', async () => {
    await page.getByRole('button', { name: 'Edit planned through' }).click();
    await page.getByPlaceholder('planned through').fill('Q2 2027');
    await page.keyboard.press('Enter');
    await expectText(page.locator('.client-meta'), 'Q2 2027');
  });

  await step('adds a meeting from the timeline', async () => {
    await page.getByRole('button', { name: 'Add meeting' }).click();
    await page.getByPlaceholder('When').fill('Fall 2027');
    await page.getByPlaceholder('e.g. Kickoff').fill('Strategy review');
    await page.getByRole('button', { name: 'Add meeting', exact: true }).last().click();
    await expectText(page.locator('.board-name'), 'Strategy review');
    await page.locator('.tl-tile.beyond').waitFor(); // after planned-through → faded
  });

  await step('adds deliverable → task → subtask, assigns and completes', async () => {
    await page.getByRole('button', { name: 'Add deliverable' }).click();
    await page.getByPlaceholder('Deliverable name, then Enter').fill('Brand audit');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByPlaceholder('Task name, then Enter').fill('Collect assets');
    await page.keyboard.press('Enter');
    await page.getByPlaceholder('Task name, then Enter').fill('Competitor scan');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const card = page.locator('.task-card', { hasText: 'Collect assets' });
    await card.hover();
    await card.getByRole('button', { name: 'Task actions' }).click();
    await page.getByRole('menuitem', { name: 'Add subtask' }).click();
    await page.getByPlaceholder('Subtask, then Enter').fill('Pull 5 sites');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'Assign' }).click();
    await page.getByPlaceholder('Search everyone…').fill('Priya');
    await page.keyboard.press('Enter');
    await expectText(card.locator('.meta-btn'), 'Priya');
    await card.getByRole('checkbox', { name: /Mark Collect assets done/ }).click();
    await card.locator('.check-box.on').first().waitFor();
    await expectText(page.locator('.column-count'), '1/2');
  });

  await step('reorders tasks by dragging', async () => {
    const first = page.locator('.task-card').nth(0);
    const second = page.locator('.task-card').nth(1);
    const a = await first.boundingBox(), b = await second.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + 10);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + 30, { steps: 4 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height - 5, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const titles = await page.locator('.task-card .task-title').allTextContents();
    if (titles[0] !== 'Competitor scan') throw new Error(`order is ${titles.join(', ')}`);
  });

  await step('ad-hoc task with a due date shows as a timeline dot', async () => {
    await page.locator('.tl-adhoc').click();
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByPlaceholder('Task name, then Enter').fill('Send SOW');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('.task-card', { hasText: 'Send SOW' }).locator('input[type=date]').fill('2026-01-15');
    await page.locator('.tl-dot.overdue').waitFor();
    await expectText(page.locator('.tl-adhoc'), '1 overdue');
  });

  await step('undo and redo', async () => {
    await page.locator('body').click({ position: { x: 600, y: 880 } });
    await page.keyboard.press('Control+z');
    await page.locator('.tl-dot').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+Shift+z');
    await page.locator('.tl-dot').waitFor();
  });

  await step('saves and everything survives a reload', async () => {
    await expectText(page.locator('.save-status'), 'Saved');
    await page.reload();
    await page.getByRole('button', { name: 'Use test storage' }).click(); // loads the saved workspace.json
    await expectText(page.locator('.client-name'), 'Test Co');
    await page.locator('.tl-tile', { hasText: 'Strategy review' }).click();
    const card = page.locator('.task-card', { hasText: 'Collect assets' });
    await card.locator('.check-box.on').first().waitFor();
    await expectText(card.locator('.meta-btn'), 'Priya');
    await expectText(card.locator('.subtask-count'), '0/1');
    const titles = await page.locator('.task-card .task-title').allTextContents();
    if (titles[0] !== 'Competitor scan') throw new Error(`order after reload is ${titles.join(', ')}`);
  });

  await step('archives a client', async () => {
    await page.getByRole('button', { name: 'Client actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive client' }).click();
    await page.locator('.banner', { hasText: 'archived' }).waitFor();
    await expectText(page.locator('.archived-toggle'), 'Archived (2)');
  });

  await step('demo client page screenshot', async () => {
    await page.locator('.client-item', { hasText: 'Northwind Health' }).click();
    await page.locator('.tl-tile.selected').waitFor();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/client-page.png' });
  });

  if (errors.length) { failed = true; console.log('  ✗ browser errors:\n    ' + errors.join('\n    ')); }
} catch {
  failed = true;
} finally {
  await browser.close();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(failed ? '\nE2E FAILED' : '\nE2E passed');
process.exit(failed ? 1 : 0);
