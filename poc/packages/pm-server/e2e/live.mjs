// Live check of the Planr test copy against a real pm-server on freshly seeded data:
//   1. seed a temp data folder, start pm-server as its own process
//   2. open /?storage=server in Chromium
//   3. create_task over MCP → the task appears in Planr with no reload
//   4. tick the task in Planr → list_tasks over MCP shows it done
// Screenshots: poc/test-results/pm-server/. Run: npm --prefix poc run e2e -w @poc/pm-server
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PKG = resolve(import.meta.dirname, '..');
const POC = resolve(PKG, '..', '..');
const REPO = resolve(POC, '..');
const OUT = join(POC, 'test-results', 'pm-server');
const APP_PORT = 18180, MCP_PORT = 18181;
const base = `http://127.0.0.1:${APP_PORT}`;
const ACME = 'poc-client-acme';
const ME = 'poc-member-alex';
const TITLE = 'Prepare the pricing update for Michael (MCP check)';
mkdirSync(OUT, { recursive: true });

if (!existsSync(join(REPO, 'dist', 'index.html'))) execFileSync('npx', ['vite', 'build'], { cwd: REPO, stdio: 'inherit' });

const dataDir = mkdtempSync(join(tmpdir(), 'pm-live-'));
execFileSync('npm', ['run', 'seed'], { cwd: POC, env: { ...process.env, POC_DATA_DIR: dataDir }, stdio: 'inherit' });

const server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { cwd: PKG, env: { ...process.env, POC_DATA_DIR: dataDir, PM_APP_PORT: String(APP_PORT), PM_MCP_PORT: String(MCP_PORT), PM_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
server.stdout.on('data', (d) => process.stdout.write(`  [pm] ${d}`));
for (let i = 0; ; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
  if (i > 100) throw new Error('pm-server did not start');
  await new Promise((r) => setTimeout(r, 100));
}

const mcp = new Client({ name: 'pm-live-check', version: '0.0.0' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`)));
const tool = async (name, args) => {
  const r = await mcp.callTool({ name, arguments: args });
  if (r.isError) throw new Error(`${name}: ${JSON.stringify(r.content)}`);
  return r.structuredContent;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.addInitScript((me) => { if (!localStorage.getItem('compensian-pm-prefs')) localStorage.setItem('compensian-pm-prefs', JSON.stringify({ meId: me })); }, ME);

let failed = false;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failed = true; console.log(`  ✗ ${name}\n    ${String(e.message).split('\n')[0]}`); await page.screenshot({ path: join(OUT, 'failure.png') }); throw e; }
};

try {
  await step('opens the test copy with the five seeded clients', async () => {
    await page.goto(`${base}/?storage=server#/week`);
    await page.locator('.ws-name', { hasText: 'POC sandbox (test data)' }).waitFor({ timeout: 8000 });
    for (const name of ['Acme Tooling', 'Harborlight Freight', 'Quillon Robotics', 'Tessera Foods', 'Internal']) {
      await page.locator('.nav-item', { hasText: name }).first().waitFor({ timeout: 4000 });
    }
    await page.screenshot({ path: join(OUT, '1-week.png') });
  });

  let created;
  await step('create_task over MCP appears in Planr without a reload', async () => {
    await page.locator('.nav-item', { hasText: 'Acme Tooling' }).locator('.nav-link').click();
    await page.locator('.adhoc-pill').click();
    await page.evaluate(() => { window.__sameDocument = true; });
    created = (await tool('create_task', { clientId: ACME, title: TITLE, assigneeIds: [ME] })).task;
    await page.locator('.task-card', { hasText: TITLE }).waitFor({ timeout: 5000 });
    if (!(await page.evaluate(() => window.__sameDocument === true))) throw new Error('the page reloaded');
    await page.screenshot({ path: join(OUT, '2-after-mcp-create.png') });
  });

  await step('ticking the task in Planr shows up in list_tasks over MCP', async () => {
    await page.locator('.task-card', { hasText: TITLE }).getByRole('checkbox', { name: new RegExp(`Mark .*done`) }).click();
    await page.locator('.task-card', { hasText: TITLE }).locator('.check-box.on').first().waitFor();
    for (let i = 0; ; i++) {
      const { tasks } = await tool('list_tasks', { clientId: ACME, includeDone: true });
      if (tasks.find((t) => t.id === created.id)?.done === true) break;
      if (i > 50) throw new Error('list_tasks never showed the task as done');
      await new Promise((r) => setTimeout(r, 100));
    }
    const { tasks: open } = await tool('list_tasks', { clientId: ACME });
    if (open.some((t) => t.id === created.id)) throw new Error('done task still listed as open');
  });

  await step('a rename in Planr is visible over MCP too, and the client fields survive', async () => {
    await page.locator('.task-card', { hasText: TITLE }).locator('.task-title').click();
    const input = page.locator('.task-card input, .task-card textarea').first();
    await input.fill(`${TITLE} (renamed)`);
    await page.keyboard.press('Enter');
    for (let i = 0; ; i++) {
      const { tasks } = await tool('list_tasks', { clientId: ACME, includeDone: true });
      if (tasks.find((t) => t.id === created.id)?.title === `${TITLE} (renamed)`) break;
      if (i > 50) throw new Error('list_tasks never showed the new title');
      await new Promise((r) => setTimeout(r, 100));
    }
    const { clients } = await tool('list_clients', {});
    const acme = clients.find((c) => c.id === ACME);
    if (!acme.emailDomains.length || !acme.nicknames.length || !acme.contacts.length || !acme.fileFolder) throw new Error('client fields lost after Planr saved');
    await page.locator('.save-pill', { hasText: 'Saved' }).waitFor();
    await page.screenshot({ path: join(OUT, '3-after-planr-edit.png') });
  });

  await step('no browser errors', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });
} catch {
  failed = true;
} finally {
  await browser.close();
  await mcp.close();
  server.kill('SIGTERM');
}
console.log(failed ? 'pm-server live check FAILED' : `pm-server live check passed (screenshots in ${OUT})`);
process.exit(failed ? 1 : 0);
