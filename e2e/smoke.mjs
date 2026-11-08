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


// Local-date helpers matching the app (ISO dates, Monday-start weeks).
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDaysIso = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoOf(new Date(y, m - 1, d + n)); };
const todayLocal = isoOf(new Date());
const mondayIso = (() => { const d = new Date(); const back = (d.getDay() + 6) % 7; return isoOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back)); })();
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longIso = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MON[m - 1]} ${d}, ${y}`; };
const saturdayIso = addDaysIso(mondayIso, 12); // a Saturday in the future

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
    await expectText(page.locator('.nav-item'), 'Northwind Health');
    await page.getByText('Which team member are you?').waitFor(); // starts on This week
    await page.locator('.nav-item', { hasText: 'Northwind Health' }).locator('.nav-link').click();
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
    // A second person: the picker stays open while ticking, and the card shows both.
    await page.getByPlaceholder('Search everyone…').fill('Marcus');
    await page.keyboard.press('Enter');
    await card.locator('.avatar-stack .avatar').nth(1).waitFor();
    await page.getByRole('menuitemcheckbox', { name: /Marcus/ }).click(); // untick again
    await page.keyboard.press('Escape');
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
    await page.locator('.adhoc-pill').click();
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByPlaceholder('Task name, then Enter').fill('Send SOW');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await page.locator('.task-card', { hasText: 'Send SOW' }).getByRole('button', { name: 'Set due date' }).click();
    await page.getByLabel('Type a date').fill('1/15/26'); // typed, with an explicit past year
    await page.keyboard.press('Enter');
    await page.locator('.tl-dot.overdue').waitFor();
    await expectText(page.locator('.adhoc-pill'), '1 overdue');
  });

  await step('undo and redo', async () => {
    await page.locator('body').click({ position: { x: 600, y: 880 } });
    await page.keyboard.press('Control+z');
    await page.locator('.tl-dot').waitFor({ state: 'detached' });
    await page.keyboard.press('Control+Shift+z');
    await page.locator('.tl-dot').waitFor();
  });

  await step('saves and everything survives a reload', async () => {
    await expectText(page.locator('.save-pill'), 'Saved');
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

  await step('imports a client file from the previous tracker', async () => {
    // Fictional client in the old export shape, with a 1×1 PNG logo.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const legacy = {
      id: 'client_e2e', name: 'Imported Widgets', customLogo: png, plannedThrough: '2027-03-01',
      staffing: { principal: ['Pat Lee'], consultant: [] }, team: [],
      meetings: [
        { id: 'adhoc', isAdHoc: true, name: '', date: '', deliverables: [{ id: '1', name: 'Billing', tasks: [{ id: '2', name: 'Send invoice', assignees: ['Pat Lee'], due: '2026-12-01', complete: false }] }] },
        { id: '3', isAdHoc: false, name: 'Fall 2026', date: '2025-10-28', deliverables: [{ id: '4', name: 'Equity guidelines', tasks: [{ id: '5', name: 'Draft', assignees: [], due: '', complete: true }] }] },
      ],
      pastMeetings: [],
    };
    await page.getByLabel('Client files to import').setInputFiles([
      { name: 'client_e2e.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) },
      { name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') },
    ]);
    await page.getByRole('dialog', { name: 'Imported 1 client' }).waitFor();
    await expectText(page.locator('.import-skipped'), 'notes.json');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expectText(page.locator('.client-name'), 'Imported Widgets');
    await page.locator('.client-header img.client-logo').waitFor();
    await page.locator('.tl-tile', { hasText: 'Fall 2026' }).waitFor();
    await page.locator('.adhoc-pill').click();
    await expectText(page.locator('.task-card'), 'Send invoice');
  });

  await step('archives and unarchives from the client menu', async () => {
    await page.locator('.nav-item', { hasText: 'Bluebird Logistics' }).locator('.nav-link').click();
    await page.getByRole('button', { name: 'Client actions' }).click();
    await page.getByRole('menuitem', { name: 'Archive client' }).click();
    await expectText(page.locator('.archived-toggle'), 'Archived (3)');
    await page.getByRole('button', { name: 'Unarchive' }).click();
    await expectText(page.locator('.archived-toggle'), 'Archived (2)');
  });

  await step('due dates show the weekday and flag weekends', async () => {
    await page.locator('.nav-item', { hasText: 'Northwind Health' }).locator('.nav-link').click();
    await page.locator('.adhoc-pill').click();
    const card = page.locator('.task-card', { hasText: 'Request 2026 org chart' });
    await card.getByRole('button', { name: /Due|Set due date/ }).click();
    await page.getByLabel('Pick a date').fill(saturdayIso); // picked from the calendar
    await expectText(card.locator('.meta-btn.weekend'), 'Sat');
  });

  await step('weekly calendar: pick me, add, check off, drag, push to next week', async () => {
    await page.locator('.nav-link-row', { hasText: 'This week' }).click();
    await page.getByPlaceholder('Find yourself…').fill('Alex');
    await page.keyboard.press('Enter');
    await page.locator('.week-grid').waitFor();
    const d1 = mondayIso, d2 = addDaysIso(mondayIso, 1);
    const cell = (iso) => page.locator('.wg-cell', { has: page.getByRole('button', { name: `Add task on ${longIso(iso)} for me` }) });
    await cell(d1).hover();
    await page.getByRole('button', { name: `Add task on ${longIso(d1)} for me` }).click();
    await page.getByPlaceholder('What needs doing?').fill('E2E week task');
    await page.screenshot({ path: 'test-results/dbg-before-add.png' });
    await page.getByRole('button', { name: 'Add task', exact: true }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/dbg-after-add.png' });
    const chip = () => page.locator('.chip', { hasText: 'E2E week task' });
    await cell(d1).locator('.chip', { hasText: 'E2E week task' }).waitFor();
    await chip().getByRole('checkbox').click();
    await page.locator('.chip.done', { hasText: 'E2E week task' }).waitFor();
    await chip().getByRole('checkbox').click();

    const drag = async (from, to) => {
      const a = await from.boundingBox(), b = await to.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 3 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
      await page.mouse.up();
      await page.waitForTimeout(120); // dnd-kit ignores clicks for 50ms after a drop
    };
    await drag(chip().locator('.chip-name'), cell(d2));
    await cell(d2).locator('.chip', { hasText: 'E2E week task' }).waitFor();
    await drag(chip().locator('.chip-name'), page.locator('.wg-next'));
    await chip().waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Next week' }).click();
    await cell(addDaysIso(mondayIso, 7)).locator('.chip', { hasText: 'E2E week task' }).waitFor();
    await page.screenshot({ path: 'test-results/week-next.png' });
  });

  await step('key task from the hover card turns gold on the calendar and the client page', async () => {
    const chip = page.locator('.chip', { hasText: 'E2E week task' });
    await chip.hover();
    await page.locator('.hover-card').getByRole('button', { name: 'Mark as key task' }).click();
    await page.locator('.chip.key', { hasText: 'E2E week task' }).waitFor();
    await page.mouse.move(5, 5);
    await chip.click();
    await page.locator('.task-card.key', { hasText: 'E2E week task' }).waitFor();
  });

  await step('month calendar: tasks on their days, drag to reschedule, only mine', async () => {
    await page.locator('.nav-link-row', { hasText: 'Month' }).click();
    await page.locator('.month-grid').waitFor();
    const nextMon = addDaysIso(mondayIso, 7);
    if (nextMon.slice(0, 7) !== todayLocal.slice(0, 7)) await page.getByRole('button', { name: 'Next month' }).click();
    const cell = (iso) => page.locator('.mg-cell').filter({ has: page.locator('.chip', { hasText: 'E2E week task' }) });
    await cell().first().waitFor();
    // Drag it two days later.
    const target = addDaysIso(nextMon, 2);
    const cells = await page.locator('.mg-cell').all();
    let targetCell = null;
    for (const c of cells) { const box = c; if ((await box.locator('.mg-date').textContent()).trim().endsWith(String(Number(target.slice(8))))) { targetCell = box; } }
    const chip = page.locator('.chip-wrap', { hasText: 'E2E week task' });
    const a = await chip.boundingBox(), b = await targetCell.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 4, { steps: 3 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(150);
    await targetCell.locator('.chip', { hasText: 'E2E week task' }).waitFor();
    const before = await page.locator('.mg-cell .chip').count();
    await page.getByLabel('Only my tasks').check();
    const after = await page.locator('.mg-cell .chip').count();
    if (!(after <= before)) throw new Error(`only mine: ${before} → ${after}`);
    await page.getByLabel('Only my tasks').uncheck();
  });

  await step('kickoff date flows to the calendar and the timeline', async () => {
    await page.locator('.nav-item', { hasText: 'Northwind Health' }).locator('.nav-link').click();
    await page.locator('.tl-tile', { hasText: 'Leadership readout' }).click();
    const kickDay = addDaysIso(mondayIso, 2);
    await page.getByRole('button', { name: 'Kickoff date' }).click();
    await page.getByLabel('Pick a date').fill(kickDay);
    await page.locator('.tl-kickoff').first().waitFor();
    await page.locator('.nav-link-row', { hasText: 'This week' }).click();
    await page.locator('.wg-cell .chip.kickoff', { hasText: 'Leadership readout' }).waitFor();
    await page.screenshot({ path: 'test-results/week.png' });
  });

  await step('exports a backup and restores it through Import', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
    const file = await download.path();
    const { readFileSync } = await import('node:fs');
    const backup = readFileSync(file, 'utf8');
    if (!backup.includes('"schemaVersion"')) throw new Error('backup has no schemaVersion');
    // Change something, then restore the backup and check the change is gone.
    await page.locator('.nav-item', { hasText: 'Atlas Manufacturing' }).locator('.nav-link').click();
    await page.getByRole('button', { name: 'Client actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete client…' }).click();
    await page.getByRole('button', { name: 'Delete client' }).click();
    await page.locator('.nav-item', { hasText: 'Atlas Manufacturing' }).waitFor({ state: 'detached' });
    await page.getByLabel('Client files to import').setInputFiles([{ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(backup) }]);
    await page.getByRole('button', { name: 'Restore backup' }).click();
    await page.locator('.nav-item', { hasText: 'Atlas Manufacturing' }).waitFor();
  });

  await step('sidebar dates and sort; planned-through flag; hide done', async () => {
    await page.locator('.sort-btn').click();
    await expectText(page.locator('.sort-btn'), 'Next meeting');
    const firstWhen = await page.locator('.client-list > .nav-item:not(.nav-link-row) .nav-when').first().textContent();
    if (!firstWhen || /scheduled|Ad-hoc/.test(firstWhen)) throw new Error(`first client has no upcoming meeting: ${firstWhen}`);
    await page.locator('.sort-btn').click();
    await page.locator('.nav-item', { hasText: 'Northwind Health' }).locator('.nav-link').click();
    await page.getByRole('button', { name: 'Edit planned through' }).click();
    await page.getByPlaceholder('planned through').fill('1/2/26');
    await page.keyboard.press('Enter');
    await page.locator('.plan-flag.passed').waitFor();
    await page.locator('.tl-tile', { hasText: 'Market data review' }).click();
    const before = await page.locator('.task-card.done').count();
    await page.getByLabel('Hide done').check();
    const after = await page.locator('.task-card.done').count();
    if (!(before > 0 && after === 0)) throw new Error(`hide done: ${before} → ${after}`);
    await page.getByLabel('Hide done').uncheck();
  });

  await step('people roles, staffing overview, copy tasks, two-step delete, year snapping', async () => {
    // Role from the People list shows up in the Staffing columns.
    await page.locator('.workspace-btn').click();
    await page.getByRole('menuitem', { name: 'Team' }).click();
    await page.getByLabel('Role for Sam Ortiz').selectOption('Principal');
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await page.locator('.nav-link-row', { hasText: 'Staffing' }).click();
    await page.locator('.staffing-table').waitFor();
    const principalCol = await page.locator('.staffing-table thead th').allTextContents();
    if (principalCol[1] !== 'Principal') throw new Error('first role column: ' + principalCol[1]);
    await page.locator('.staffing-table tbody tr', { hasText: 'Northwind Health' }).click();
    await expectText(page.locator('.client-name'), 'Northwind Health');

    // Copy all tasks on a meeting.
    await page.locator('.tl-tile', { hasText: 'Market data review' }).click();
    await page.getByRole('button', { name: 'Meeting actions' }).click();
    await page.getByRole('menuitem', { name: 'Copy all tasks' }).click();
    await page.locator('.toast', { hasText: /Copied|Couldn't copy/ }).waitFor();

    // Two-step delete of a task.
    const card = page.locator('.task-card').first();
    const title = await card.locator('.task-title').textContent();
    await card.hover();
    await card.getByRole('button', { name: 'Task actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete task' }).click();
    await page.getByRole('menuitem', { name: 'Click again to delete' }).click();
    await page.locator('.task-card', { hasText: title }).first().waitFor({ state: 'detached' }).catch(async () => {
      if (await page.locator('.task-card .task-title', { hasText: new RegExp('^' + title + '$') }).count()) throw new Error('task not deleted');
    });

    // A yearless date snaps: 1/15 typed in November means next January.
    await page.getByRole('button', { name: 'Add meeting' }).click();
    await page.getByPlaceholder('When').fill('1/15');
    await page.locator('.flex-preview', { hasText: /Jan 15, \d{4}/ }).waitFor();
    await page.keyboard.press('Escape');
  });

  await step('time tracking: start, switch client (no double count), stop, edit, resume, timesheet, reload', async () => {
    await page.locator('.nav-link-row', { hasText: 'Time' }).click();
    await page.getByText('Start your first timer').waitFor();
    await page.getByLabel('Client', { exact: true }).fill('Northwind Health');
    await page.getByLabel('OpenAir task', { exact: true }).first().selectOption({ label: 'Analysis' });
    await page.getByLabel('Note', { exact: true }).first().fill('market data');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.locator('.timer-pill', { hasText: 'Northwind Health' }).waitFor();
    await page.waitForTimeout(1300);
    // Switch client while running: the Northwind stretch is saved and the timer restarts on Summit.
    await page.getByLabel('Client', { exact: true }).fill('Summit Credit Union');
    await page.getByLabel('Note', { exact: true }).first().click(); // blur the client field
    await page.locator('.timer-pill', { hasText: 'Summit Credit Union' }).waitFor();
    await page.waitForTimeout(1300);
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.locator('.timer-pill').waitFor({ state: 'detached' });
    await page.locator('.te-group', { hasText: 'Northwind Health' }).waitFor();
    await page.locator('.te-group', { hasText: 'Summit Credit Union' }).waitFor();
    const groups = await page.locator('.te-group').count();
    if (groups !== 2) throw new Error(`expected 2 groups, got ${groups}`);

    // Edit times with smart typing: 9 → 10:30 is 1h 30m.
    const nw = page.locator('.te-group', { hasText: 'Northwind Health' });
    await nw.locator('.te-group-toggle').click();
    await nw.getByRole('button', { name: 'Reassign or edit date and times' }).click();
    await page.getByLabel('Start', { exact: true }).fill('9');
    await page.getByLabel('End', { exact: true }).fill('10:30');
    await page.getByRole('button', { name: 'Save' }).click();
    await expectText(page.locator('.te-group', { hasText: 'Northwind Health' }).locator('.te-group-toggle .te-total'), '1h 30m');

    // Resume starts a new timer like that entry; stop it again.
    await page.locator('.te-group', { hasText: 'Northwind Health' }).getByRole('button', { name: 'Resume' }).click();
    await page.locator('.timer-pill', { hasText: 'Northwind Health' }).waitFor();
    await page.locator('.tp-stop').click();

    // Timesheet shows the hours (1.5h for Northwind on today's column).
    await page.getByRole('button', { name: 'Weekly timesheet' }).click();
    await page.locator('.ts-table tbody tr', { hasText: 'Northwind Health' }).waitFor();
    await expectText(page.locator('.ts-table tbody tr', { hasText: 'Northwind Health' }).locator('td').last(), '1.5');
    await page.getByRole('button', { name: /Rounding/ }).click();
    await expectText(page.getByRole('button', { name: /Rounding/ }), '0.1h');
    await page.keyboard.press('Escape');

    // Time is personal data in its own file and survives a reload.
    await page.waitForTimeout(600);
    await page.reload();
    await page.getByRole('button', { name: 'Use test storage' }).click();
    await page.locator('.nav-link-row', { hasText: 'Time' }).click();
    await page.locator('.te-group', { hasText: 'Northwind Health' }).waitFor();
  });

  await step('demo client page screenshot', async () => {
    await page.locator('.nav-item', { hasText: 'Northwind Health' }).click();
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
