// End-to-end walkthrough of the sidebar at 400 px wide against the fixture
// brain, in Chromium with a fake microphone. Also writes the light and dark
// screenshots to poc/test-results/sidebar/.
//
//   npm --prefix poc run e2e -w @poc/sidebar      (builds first)
//   node e2e/walkthrough.mjs                       (uses the existing dist/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = resolve(pkg, '../../test-results/sidebar');
mkdirSync(shots, { recursive: true });
const PORT = 5193;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [resolve(pkg, '../../node_modules/tsx/dist/cli.mjs'), 'fixture/server.ts', '--port', String(PORT), '--static', 'dist'], {
  cwd: pkg,
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((ok, fail) => {
  const t = setTimeout(() => fail(new Error('fixture server did not start')), 15000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('fixture brain on')) {
      clearTimeout(t);
      ok();
    }
  });
});

const api = async (path, init) => {
  const r = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  return r.json();
};
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });

let failed = 0;
let passed = 0;
const errors = [];
let allowNetworkErrors = false;

async function newPage(colorScheme) {
  const context = await browser.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 1, colorScheme, timezoneId: 'UTC', permissions: ['microphone'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${colorScheme}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    // During the deliberate outage the browser logs the refused requests; nothing else may log.
    if (allowNetworkErrors && /503|ERR_|EventSource|net::/.test(text)) return;
    errors.push(`[${colorScheme}] console.${m.type()}: ${text}`);
  });
  return { context, page };
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${String(e.message ?? e).split('\n')[0]}`);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const shot = (page, name) => page.screenshot({ path: `${shots}/${name}.png` });
const scrollTo = (page, selector) => page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
const scrollMainTop = (page) => page.locator('.main-scroll').evaluate((el) => (el.scrollTop = 0));

async function openTask(page, taskId) {
  await page.locator(`li[data-task-id="${taskId}"] .task-main`).click();
  await page.locator('.panel-head').waitFor();
}
async function back(page) {
  await page.getByRole('button', { name: 'Back to the list' }).click();
  await page.locator('.section').first().waitFor();
}

// ---------------------------------------------------------------------------
console.log('Walkthrough (light, 400 px)');
await post('/__fixture/reset');
{
  const { context, page } = await newPage('light');
  await page.goto(BASE + '/');
  await page.locator('.section').first().waitFor();

  await step('sections render in the order the brain sends them', async () => {
    const state = await api('/api/state');
    const shown = await page.locator('.section').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    expect(JSON.stringify(shown) === JSON.stringify(state.sections.map((s) => s.key)), `got ${shown.join(',')}`);
    const today = await page.locator('[data-section="today"] li[data-task-id]').evaluateAll((els) => els.map((e) => e.dataset.taskId));
    const sentToday = state.sections.find((s) => s.key === 'today').items.map((t) => t.taskId);
    expect(JSON.stringify(today) === JSON.stringify(sentToday), 'today order differs');
  });
  await shot(page, 'light-main-list');

  await step('nudge → review → approve → task lands in Today and the list reorders', async () => {
    await page.locator('[data-nudge-id="n-acme"]').getByRole('button', { name: /Review 3 suggestions/ }).click();
    const card = page.locator('[data-suggestion-id="sg-acme-update"]');
    await card.waitFor();
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    const row = page.locator('[data-section="today"] li[data-task-id]', { hasText: 'Send Michael a project status update' });
    await row.waitFor({ timeout: 4000 });
    const ids = await page.locator('[data-section="today"] li[data-task-id]').evaluateAll((els) => els.map((e) => e.textContent));
    expect(ids[1]?.includes('Send Michael a project status update'), 'new task should be second in Today');
    const log = await api('/__fixture/log');
    const a = log.find((l) => l.action === 'approve' && l.id === 'sg-acme-update');
    expect(a && JSON.stringify(a.body) === '{}', `approve body ${JSON.stringify(a?.body)}`);
  });

  await step('edit a suggestion, approve with edits', async () => {
    const card = page.locator('[data-suggestion-id="sg-acme-meet"]');
    await card.getByRole('button', { name: 'Edit' }).click();
    const title = card.getByLabel('Task');
    await title.fill('Book 45 minutes with Michael next week');
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, 'light-suggestion-edit');
    await card.getByRole('button', { name: 'Approve with changes' }).click();
    await page.locator('li[data-task-id]', { hasText: 'Book 45 minutes with Michael next week' }).waitFor({ timeout: 4000 });
    const log = await api('/__fixture/log');
    const a = log.find((l) => l.action === 'approve' && l.id === 'sg-acme-meet');
    expect(a?.body?.edits?.payload?.title === 'Book 45 minutes with Michael next week' && a.body.edits.title === 'Book 45 minutes with Michael next week', `edits ${JSON.stringify(a?.body)}`);
  });

  await step('deny a duplicate', async () => {
    const card = page.locator('[data-suggestion-id="sg-acme-dup"]');
    expect(await card.getByText(/Possible duplicate/).isVisible(), 'duplicate marker missing');
    await card.getByRole('button', { name: 'Deny' }).click();
    await card.waitFor({ state: 'detached', timeout: 4000 });
    const log = await api('/__fixture/log');
    expect(log.some((l) => l.action === 'deny' && l.id === 'sg-acme-dup'), 'no deny call');
  });

  await step('confirm an uncertain client from Inbox', async () => {
    const card = page.locator('[data-suggestion-id="sg-confirm"]');
    await card.getByLabel('Which client is this?').selectOption('poc-client-quillon');
    await card.getByRole('button', { name: 'Approve', exact: true }).click();
    await card.waitFor({ state: 'detached', timeout: 4000 });
    const log = await api('/__fixture/log');
    const a = log.find((l) => l.action === 'approve' && l.id === 'sg-confirm');
    expect(a?.body?.edits?.clientId === 'poc-client-quillon', `body ${JSON.stringify(a?.body)}`);
    // The related suggestion now carries the client (no longer in Inbox).
    await page.locator('.waiting [data-suggestion-id="sg-robo-deck"]').waitFor({ timeout: 4000 });
  });

  await step('failed suggestion shows its error and can be retried', async () => {
    const card = page.locator('[data-suggestion-id="sg-failed"]');
    expect(await card.getByText('The PM app did not answer in time').isVisible(), 'error text missing');
    await card.getByRole('button', { name: 'Try again' }).click();
    await card.waitFor({ state: 'detached', timeout: 4000 });
  });

  const views = [
    ['t-acme-pricing', 'reply_email'],
    ['t-harbor-meet', 'schedule_meeting'],
    ['t-quill-levels', 'review_file'],
    ['t-tess-chase', 'follow_up'],
    ['t-acme-survey', 'other'],
  ];
  for (const [taskId, type] of views) {
    await step(`prepared work opens: ${type}`, async () => {
      await scrollMainTop(page);
      await openTask(page, taskId);
      await page.locator(`[data-prepared-type="${type}"]`).waitFor({ timeout: 4000 });
      await shot(page, `light-prepared-${type}`);
      await back(page);
    });
  }

  await step('edit and send the drafted reply (meeting slot inserted)', async () => {
    await openTask(page, 't-harbor-meet');
    await page.getByRole('button', { name: 'Edit' }).click();
    await page.locator('.slot-insert button').nth(2).click();
    await shot(page, 'light-prepared-schedule_meeting-edit');
    await page.getByRole('button', { name: 'Approve with changes' }).click();
    await page.getByText('The email is sent').waitFor({ timeout: 4000 });
    const sent = await api('/__fixture/sent');
    expect(sent.length === 1 && sent[0].to[0].address === 'dmitri.vance@harborlight.example', 'mail not sent');
    const log = await api('/__fixture/log');
    const a = log.find((l) => l.action === 'approve' && l.id === 'sg-prep-harbor-meet');
    expect(a?.body?.edits?.payload?.draft?.body?.split('\n- ').length > 3, 'edited draft not sent');
    await back(page);
  });

  await step('approve a file review → the next step lines up', async () => {
    await openTask(page, 't-quill-levels');
    await page.getByRole('button', { name: 'Approve: mark reviewed' }).click();
    await page.locator('.pw-next [data-suggestion-id]').waitFor({ timeout: 4000 });
    await shot(page, 'light-prepared-next-step');
    await back(page);
  });

  await step('regenerate shows "Preparing…" and then the new draft', async () => {
    await openTask(page, 't-tess-chase');
    await page.getByRole('button', { name: 'Regenerate' }).click();
    await page.getByText('Preparing…').waitFor({ timeout: 2000 });
    await page.locator('[data-prepared-type="follow_up"]').waitFor({ timeout: 6000 });
    expect(await page.getByText('another take').isVisible(), 'regenerated draft not shown');
    await back(page);
  });

  await step('hold and unhold a task', async () => {
    await page.getByRole('button', { name: /Put “Update the Harborlight project plan” on hold/ }).click();
    await page.locator('[data-section="on_hold"] li', { hasText: 'Update the Harborlight project plan' }).waitFor({ timeout: 4000 });
    await page.getByRole('button', { name: /Take “Update the Harborlight project plan” off hold/ }).click();
    await page.locator('[data-section="on_hold"] li', { hasText: 'Update the Harborlight project plan' }).waitFor({ state: 'detached', timeout: 4000 });
  });

  await step('typed chat streams and a suggestion appears inline', async () => {
    await page.getByLabel('Message the assistant').fill('Add a task to chase Lena on Friday');
    await page.keyboard.press('Enter');
    const bubble = page.locator('.msg-assistant .msg-text').last();
    await bubble.waitFor();
    const early = (await bubble.textContent()).length;
    await page.locator('.msg-assistant[data-status="done"]').last().waitFor({ timeout: 5000 });
    const late = (await page.locator('.msg-assistant .msg-text').last().textContent()).length;
    expect(late > early, `text did not stream (${early} → ${late})`);
    await page.locator('.msg-cards [data-kind="create_task"]').waitFor();
    await shot(page, 'light-chat');
  });

  await step('voice: fake mic frames reach WS /api/voice, live partial, reply, barge-in', async () => {
    await page.getByRole('button', { name: 'Talk to the assistant' }).click();
    await page.locator('.voice-strip', { hasText: 'Listening' }).waitFor({ timeout: 5000 });
    await page.locator('#composer-partial').waitFor({ timeout: 5000 });
    const partial = await page.locator('#composer-partial').textContent();
    expect(/add a task/.test(partial), `partial "${partial}"`);
    await page.locator('.msg-user', { hasText: 'chase Michael on Friday' }).waitFor({ timeout: 6000 });
    await page.locator('.voice-strip', { hasText: 'Speaking' }).waitFor({ timeout: 5000 });
    const stats = await api('/__fixture/voice');
    expect(stats.starts === 1 && stats.frames >= 100 && stats.badFrames === 0 && stats.lastFrameBytes === 640, `voice stats ${JSON.stringify(stats)}`);
    await shot(page, 'light-chat-voice-speaking');
    await post('/__fixture/interrupt');
    await page.locator('.msg-assistant[data-status="interrupted"]').waitFor({ timeout: 3000 });
    await page.locator('.voice-strip', { hasText: 'Listening' }).waitFor({ timeout: 3000 });
    // Suggestion proposed by voice shows inline on that turn.
    await page.locator('.msg-assistant[data-status="interrupted"] [data-kind="create_task"]').waitFor({ timeout: 3000 });
    await page.getByRole('button', { name: 'Stop voice' }).click();
    await page.locator('.voice-strip').waitFor({ state: 'detached', timeout: 3000 });
    const after = await api('/__fixture/voice');
    expect(after.stops === 1, 'no stop message');
  });

  await step('client profile renders', async () => {
    await page.getByRole('button', { name: 'Client profiles' }).click();
    await page.getByRole('button', { name: /Acme Tooling Co\./ }).click();
    await page.locator('.md').getByText('Key contacts').waitFor();
    await shot(page, 'light-profile');
    await page.getByRole('button', { name: 'Back to client profiles' }).click();
    await page.getByRole('button', { name: 'Back to the list' }).click();
  });

  await step('a nudge arriving live appears at the top', async () => {
    await page.getByRole('tab', { name: /My day/ }).click();
    await post('/__fixture/drop');
    await page.locator('.nudge').first().getByText('Lena Hartwell just sent').waitFor({ timeout: 4000 });
  });

  await step('keyboard: Tab reaches a task, Enter opens it, Escape closes', async () => {
    await scrollMainTop(page);
    await page.locator('[data-section="today"] .task-main').first().focus();
    await page.keyboard.press('Enter');
    await page.locator('.panel-head').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.section').first().waitFor();
  });

  await step('connection lost shows a banner, then recovers', async () => {
    allowNetworkErrors = true;
    await post('/__fixture/outage', { ms: 2500 });
    await page.locator('.banner').waitFor({ timeout: 4000 });
    await shot(page, 'light-connection-lost');
    await page.locator('.banner').waitFor({ state: 'detached', timeout: 8000 });
    allowNetworkErrors = false;
  });

  await context.close();
}

// ---------------------------------------------------------------------------
for (const scheme of ['dark']) {
  console.log(`Screenshots (${scheme})`);
  await post('/__fixture/reset');
  const { context, page } = await newPage(scheme);
  await page.goto(BASE + '/');
  await page.locator('.section').first().waitFor();
  await step(`${scheme}: main list`, async () => shot(page, `${scheme}-main-list`));
  await step(`${scheme}: suggestion card in edit mode`, async () => {
    await page.locator('[data-nudge-id="n-acme"]').getByRole('button', { name: /Review 3 suggestions/ }).click();
    const card = page.locator('[data-suggestion-id="sg-acme-meet"]');
    await card.getByRole('button', { name: 'Edit' }).click();
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await shot(page, `${scheme}-suggestion-edit`);
    await card.getByRole('button', { name: 'Cancel' }).click();
  });
  for (const [taskId, type] of [
    ['t-acme-pricing', 'reply_email'],
    ['t-harbor-meet', 'schedule_meeting'],
    ['t-quill-levels', 'review_file'],
    ['t-tess-chase', 'follow_up'],
    ['t-acme-survey', 'other'],
  ]) {
    await step(`${scheme}: prepared ${type}`, async () => {
      await scrollMainTop(page);
      await openTask(page, taskId);
      await page.locator(`[data-prepared-type="${type}"]`).waitFor({ timeout: 4000 });
      await shot(page, `${scheme}-prepared-${type}`);
      await back(page);
    });
  }
  await step(`${scheme}: chat`, async () => {
    await page.getByLabel('Message the assistant').fill('What should I do first?');
    await page.keyboard.press('Enter');
    await page.locator('.msg-assistant[data-status="done"]').waitFor({ timeout: 5000 });
    await page.getByLabel('Message the assistant').fill('Add a task to chase Gareth on Friday');
    await page.keyboard.press('Enter');
    await page.locator('.msg-cards [data-kind="create_task"]').waitFor({ timeout: 5000 });
    await page.locator('.msg-assistant[data-status="done"]').nth(1).waitFor({ timeout: 5000 });
    await shot(page, `${scheme}-chat`);
  });
  await step(`${scheme}: profile`, async () => {
    await page.getByRole('button', { name: 'Client profiles' }).click();
    await page.getByRole('button', { name: /Acme Tooling Co\./ }).click();
    await page.locator('.md').waitFor();
    await shot(page, `${scheme}-profile`);
  });
  await context.close();
}

await step('no console errors or page errors', async () => {
  expect(errors.length === 0, errors.join('\n    '));
});

await browser.close();
server.kill();
console.log(`\n${passed} passed, ${failed} failed. Screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
