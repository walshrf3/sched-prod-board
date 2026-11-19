// Local checks of R1–R6 against a mocked incident API (no real acks are sent).
// Usage: node tests/board.test.mjs   (serves dist/ itself)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const p = join(root, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  try { res.writeHead(200, { 'content-type': types[extname(p)] || 'text/plain' }).end(await readFile(p)); }
  catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

let failures = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) failures++; };

const inc = (id, openedAt, summary = 'x') => ({ id, service: 'svc', region: 'eu', summary, severity: 'sev2', openedAt });
async function mocked(page, { delay = 0, pages }) {
  let n = 0; const acks = [];
  await page.route('**/api/incidents**', async (route) => {
    if (delay && n === 0) await new Promise((r) => setTimeout(r, delay));
    const incidents = pages[Math.min(n++, pages.length - 1)];
    route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents, cursor: `c${n}` } });
  });
  await page.route('**/api/ack**', (route) => {
    const u = new URL(route.request().url()); acks.push(u.searchParams.get('id'));
    route.fulfill({ json: { id: u.searchParams.get('id'), ackedAt: new Date().toISOString(), receipt: 'r' } });
  });
  return { acks, calls: () => n };
}

const browser = await chromium.launch();
try {
  // R3 loader, R1 order, R2 ack, R4 refresh, R6 sha
  {
    const page = await browser.newPage();
    const a = inc('A', '2026-11-19T10:00:00Z', '<img src=x onerror=alert(1)>'), b = inc('B', '2026-11-19T11:00:00Z'), c = inc('C', '2026-11-19T12:00:00Z');
    await page.addInitScript(() => { window.__removed = 0; new MutationObserver((rs) => rs.forEach((r) => r.removedNodes.forEach((n) => { if (n.dataset?.testid === 'incident-row') window.__removed++; }))).observe(document, { childList: true, subtree: true }); });
    const m = await mocked(page, { delay: 800, pages: [[a, b], [a, b], [c, b, a]] });
    await page.goto(base);
    check('R3 loader visible on open', await page.getByTestId('loader').isVisible());
    await page.getByTestId('incident-row').first().waitFor();
    check('R3 loader gone after load', (await page.getByTestId('loader').count()) === 0);
    const ids = async () => page.getByTestId('incident-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    check('R1 newest first', JSON.stringify(await ids()) === '["B","A"]', JSON.stringify(await ids()));
    check('summary rendered as text', (await page.locator('img').count()) === 0);
    const rowA = page.locator('[data-testid=incident-row][data-id=A]');
    await rowA.getByTestId('ack').click();
    await rowA.getByTestId('acked').waitFor();
    check('R2 ack sends that id', JSON.stringify(m.acks) === '["A"]', JSON.stringify(m.acks));
    await page.getByTestId('new-bar').waitFor({ state: 'visible', timeout: 7000 });
    check('SCHED-4515 list holds still while new incidents wait', JSON.stringify(await ids()) === '["B","A"]', JSON.stringify(await ids()));
    check('SCHED-4515 bar counts held incidents', /^1 new incident/.test(await page.getByTestId('new-bar').textContent()), await page.getByTestId('new-bar').textContent());
    const removed = await page.evaluate(() => window.__removed);
    await page.getByTestId('new-bar').click();
    check('R1 new-bar click brings new incident in on top', JSON.stringify(await ids()) === '["C","B","A"]', JSON.stringify(await ids()));
    check('SCHED-4515 bar hides after click', !(await page.getByTestId('new-bar').isVisible()));
    check('no row removed', removed === 0, String(removed));
    const before = m.calls(); await page.waitForTimeout(4500);
    check('R4 refresh about every 2 s', m.calls() - before >= 2 && m.calls() - before <= 3, `${m.calls() - before} calls in 4.5 s`);
    const sha = await page.locator('meta[name=build]').getAttribute('content');
    check('R6 meta and footer sha match', /^[0-9a-f]{40}$/.test(sha) && sha === (await page.getByTestId('build-sha').textContent()), sha);
    await page.close();
  }
  // SCHED-4515: an incident landing while the pointer is on a row does not move it
  {
    const page = await browser.newPage();
    const a = inc('A', '2026-11-19T10:00:00Z'), b = inc('B', '2026-11-19T11:00:00Z'), d = inc('D', '2026-11-19T13:00:00Z');
    const m = await mocked(page, { pages: [[b, a], [b, a], [d, b, a]] });
    await page.goto(base);
    const btn = page.locator('[data-testid=incident-row][data-id=B] [data-testid=ack]');
    const box = await btn.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.getByTestId('new-bar').waitFor({ state: 'visible', timeout: 7000 });
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('[data-testid=incident-row][data-id=B] [data-testid=acked]').waitFor();
    check('SCHED-4515 ack aimed at B during an arrival acks B', JSON.stringify(m.acks) === '["B"]', JSON.stringify(m.acks));
    await page.close();
  }
  // empty state
  {
    const page = await browser.newPage(); await mocked(page, { pages: [[]] }); await page.goto(base);
    await page.getByTestId('empty').waitFor();
    check('empty state shows', await page.getByTestId('empty').isVisible());
    await page.close();
  }
  // R5 local times
  for (const [locale, timezoneId, want] of [['en-NZ', 'Pacific/Auckland', '18/11, 04:11 pm'], ['de-DE', 'Europe/Berlin', '18.11., 04:11'], ['en-US', 'America/New_York', '11/17, 10:11 PM']]) {
    const ctx = await browser.newContext({ locale, timezoneId }); const page = await ctx.newPage();
    await mocked(page, { pages: [[inc('T', '2026-11-18T03:11:00.000Z')]] }); await page.goto(base);
    const t = page.locator('time').first(); await t.waitFor();
    const text = (await t.textContent()).replace(/ | /g, ' ');
    check(`R5 ${locale} ${timezoneId}`, text.toLowerCase() === want.toLowerCase() && (await t.getAttribute('datetime')) === '2026-11-18T03:11:00.000Z', `"${text}"`);
    await ctx.close();
  }
} finally { await browser.close(); server.close(); }
process.exit(failures ? 1 : 0);
