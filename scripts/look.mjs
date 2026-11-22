// Quick stills of the demo build while iterating on the look:
//   npx vite build --config demo/vite.config.ts && node scripts/look.mjs [Mon..Sun]
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
const day = process.argv[2] ?? 'Wed';

const browser = await chromium.launch({ executablePath: browserPath });
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await phone.newPage();
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/game.html?s=fresh&day=${day}`);
await page.waitForTimeout(1000);
await page.screenshot({ path: join(out, '1-title.png') });
// The first-time view: the hand showing the drag.
await page.getByRole('button', { name: /^Play/ }).click();
await page.waitForTimeout(1150);
await page.screenshot({ path: join(out, '9-coach.png'), clip: { x: 0, y: 100, width: 390, height: 420 } });
const { solution } = await page.evaluate(() => window.__demo);
await page.goto(`${base}/game.html?s=fresh&day=${day}&auto=${encodeURIComponent(JSON.stringify(solution))}`);
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, '1-title.png') });
await page.getByRole('button', { name: /^Play/ }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, '2-aiming.png') });
await page.waitForTimeout(1300);
await page.screenshot({ path: join(out, '3-sliding.png') });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, '4-sliding.png') });
await page.getByRole('button', { name: /again/i }).waitFor({ timeout: 60000 });
await page.waitForTimeout(400);
await page.screenshot({ path: join(out, '5-results.png') });

// Close-ups for judging the pixel art: the island at 6x.
const zoom = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
const z = await zoom.newPage();
await z.goto(`${base}/game.html?s=fresh&day=${day}&auto=${encodeURIComponent(JSON.stringify(solution))}`);
await z.waitForTimeout(1000);
await z.getByRole('button', { name: /^Play/ }).click();
await z.waitForTimeout(1200);
await z.screenshot({ path: join(out, '8-closeup.png'), clip: { x: 0, y: 90, width: 390, height: 470 } });

const p2 = await phone.newPage();
await p2.goto(`${base}/game.html?s=played&day=${day}`);
await p2.waitForTimeout(1200);
await p2.screenshot({ path: join(out, '6-returning.png') });

const card = await browser.newContext({ viewport: { width: 390, height: 520 }, deviceScaleFactor: 2 });
const p3 = await card.newPage();
await p3.goto(`${base}/splash.html?s=fresh&day=${day}`);
await p3.waitForTimeout(1200);
await p3.screenshot({ path: join(out, '0-feed-card.png') });

const desk = await browser.newContext({ viewport: { width: 1100, height: 760 }, deviceScaleFactor: 1 });
const p4 = await desk.newPage();
await p4.goto(`${base}/game.html?s=fresh&day=${day}`);
await p4.waitForTimeout(1200);
await p4.getByRole('button', { name: /^Play/ }).click();
await p4.waitForTimeout(600);
await p4.screenshot({ path: join(out, '7-desktop.png') });

await browser.close();
server.close();
console.log('stills in recordings/look');
