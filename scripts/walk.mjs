// Walks the replay and the island editor in the demo build, checking each step and
// saving stills to recordings/look:
//   npx vite build --config demo/vite.config.ts && node scripts/walk.mjs
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist-demo');
const out = join(root, 'recordings', 'look');
mkdirSync(out, { recursive: true });
const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(site) || !existsSync(path)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: browserPath });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && problems.push(`console: ${m.text()}`));
const shot = (name) => page.screenshot({ path: join(out, `${name}.png`) });
const say = (label, value) => console.log(label.padEnd(26), value);

// Board coordinates -> page coordinates, from what the canvas publishes.
const at = async (x, y) => {
  const [bx, by, scale] = (await page.locator('canvas.scene').getAttribute('data-board')).split(',').map(Number);
  return [(bx + x) * scale, (by + y) * scale];
};
const tap = async (x, y) => {
  const [px, py] = await at(x, y);
  await page.mouse.click(px, py);
};
const drag = async (x0, y0, x1, y1) => {
  const [ax, ay] = await at(x0, y0);
  const [bx, by] = await at(x1, y1);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 10 });
  await page.mouse.up();
};
const DIR = (d) => [Math.cos((d * Math.PI) / 36), Math.sin((d * Math.PI) / 36)];
const REACH = { grass: [0, 13, 25, 37, 49, 61, 74, 86, 98], ice: [0, 22, 43, 64, 85, 106, 128, 149, 170] };
const pushDone = () =>
  page.waitForFunction(() => {
    const b = document.querySelector('.push-row .btn.big');
    return !b || b.disabled === false;
  }, null, { timeout: 60000 });

// ---- replay ----
await page.goto(`${base}/game.html?s=fresh&day=Mon`);
await page.waitForTimeout(800);
const { solution } = await page.evaluate(() => window.__demo);
await page.goto(`${base}/game.html?s=fresh&day=Mon&auto=${encodeURIComponent(JSON.stringify(solution))}`);
await page.getByRole('button', { name: /^Play/ }).click();
await page.getByRole('button', { name: /^Replay/ }).waitFor({ timeout: 60000 });
await page.waitForTimeout(700);
await page.getByRole('button', { name: /^Replay/ }).click();
await page.waitForTimeout(2600);
say('replay label', await page.locator('.turns .lbl').innerText());
say('replay hint', await page.locator('.hint').innerText());
await shot('walk-1-replay');
await page.getByRole('button', { name: /again/i }).first().waitFor({ timeout: 60000 });
say('replay ends on results', 'yes');

// ---- the editor ----
await page.getByRole('button', { name: 'Build your own island' }).click();
await page.waitForTimeout(600);
await shot('walk-2-build');
let draft = await page.evaluate(() => window.__draft);
say('starter island', `${draft.foes.length} foes, ${draft.turns} turns`);

// Find an island that can be beaten, shuffling if need be.
let plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
for (let i = 0; i < 8 && plan.outs === 0; i++) {
  await page.getByRole('button', { name: 'Shuffle' }).click();
  await page.waitForTimeout(250);
  plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
}
draft = await page.evaluate(() => window.__draft);
say('a push that scores', JSON.stringify(plan));

// Boulders: tap free spots until one lands.
await page.getByRole('button', { name: 'Boulders' }).click();
for (const [dx, dy] of [[24, 24], [-24, 24], [24, -24], [-24, -24], [0, 30], [30, 0]]) {
  await tap(draft.you.x + dx, draft.you.y + dy);
  await page.waitForTimeout(120);
  if ((await page.evaluate(() => window.__draft.rocks.length)) > 0) break;
}
say('boulders placed', await page.evaluate(() => window.__draft.rocks.length));
// A second tap grows it.
const rock = await page.evaluate(() => window.__draft.rocks[0]);
if (rock) {
  await tap(rock.x, rock.y);
  await page.waitForTimeout(150);
  say('boulder after a tap', JSON.stringify(await page.evaluate(() => window.__draft.rocks[0] ?? 'removed')));
}
// Foes: add one, then remove it again with a tap.
await page.getByRole('button', { name: 'Foes' }).click();
const before = draft.foes.length;
for (const [dx, dy] of [[-30, 0], [0, -30], [30, 30], [-30, -30], [36, -10]]) {
  await tap(draft.you.x + dx, draft.you.y + dy);
  await page.waitForTimeout(120);
  if ((await page.evaluate(() => window.__draft.foes.length)) > before) break;
}
say('foes after adding', `${before} -> ${await page.evaluate(() => window.__draft.foes.length)}`);
const added = await page.evaluate(() => window.__draft.foes.at(-1));
if ((await page.evaluate(() => window.__draft.foes.length)) > before) {
  await tap(added.x, added.y);
  await page.waitForTimeout(150);
  say('foes after a tap on it', await page.evaluate(() => window.__draft.foes.length));
}
// Cut a notch, then paint it back.
const cells = (d) => d.shape.join('').split('#').length - 1;
const c0 = cells(await page.evaluate(() => window.__draft));
await page.getByRole('button', { name: 'Cut away' }).click();
await drag(20, 20, 150, 30);
const c1 = cells(await page.evaluate(() => window.__draft));
await page.getByRole('button', { name: 'Add grass' }).click();
await drag(60, 16, 110, 16);
const c2 = cells(await page.evaluate(() => window.__draft));
say('grass cells: cut, paint', `${c0} -> ${c1} -> ${c2}`);
await shot('walk-3-built');

// The cut may have changed what works; solve the final island again.
plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
draft = await page.evaluate(() => window.__draft);
say('line for the final island', JSON.stringify(plan));

// ---- play it through ----
await page.getByRole('button', { name: /Play it through/ }).click();
await page.waitForTimeout(700);
say('play hint', await page.locator('.hint').innerText());
for (const [i, move] of plan.moves.entries()) {
  if (!(await page.locator('.push-row .btn.big').count())) break;
  if (move.p > 0) {
    const you = JSON.parse(await page.locator('canvas.scene').getAttribute('data-slimes'))[0];
    const reach = REACH[draft.ice ? 'ice' : 'grass'][move.p];
    const [ux, uy] = DIR(move.d);
    await drag(you.x + ux * 4, you.y + uy * 4, you.x + ux * reach, you.y + uy * reach);
    await page.waitForTimeout(400);
  }
  if (i === 0) {
    await shot('walk-4-play-through');
    say('power set by the drag', await page.locator('.power').getAttribute('aria-label'));
  }
  await page.locator('.push-row .btn.big').click();
  await page.waitForFunction(() => document.querySelector('.push-row .btn.big')?.disabled === true);
  await pushDone();
  await page.waitForTimeout(300);
}
for (let t = 0; t < 5 && (await page.locator('.push-row .btn.big').count()); t++) {
  await page.locator('.push-row .btn.big').click();
  await page.waitForTimeout(300);
  await pushDone();
  await page.waitForTimeout(300);
}
await page.getByRole('button', { name: /Play again/ }).waitFor({ timeout: 30000 });
await page.waitForTimeout(300);
say('post sheet', (await page.locator('.sheet .kicker').innerText()) + ' / ' + (await page.locator('.sheet .headline').innerText()));
await shot('walk-6-post');
const canPost = await page.getByRole('button', { name: /Post island/ }).count();
if (canPost) {
  await page.getByRole('button', { name: /Post island/ }).click();
  await page.waitForTimeout(900);
  const posted = await page.evaluate(() => window.__posted ?? null);
  say('posted', posted ? `par ${posted.par}, ${posted.foes.length} foes, ${posted.rocks?.length ?? 0} boulders, kinds ${posted.foes.map((f) => f.kind).join(", ")}` : 'NO');
  await shot('walk-7-posted');
} else say('posted', 'not offered');

say('problems', problems.length ? problems.join(' | ') : 'none');
await browser.close();
server.close();
