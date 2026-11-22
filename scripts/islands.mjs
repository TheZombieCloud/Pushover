// Close-ups of several islands, for judging the art across shapes:
//   npx vite build --config demo/vite.config.ts && node scripts/islands.mjs
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

const picks = (process.argv[2] ?? 'Mon:0,Tue:1,Wed:2,Thu:3,Fri:4,Sat:5,Sun:6,Mon:7').split(',').map((p) => p.split(':'));
const browser = await chromium.launch({ executablePath: browserPath });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
for (const [day, week] of picks) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/game.html?s=fresh&day=${day}&week=${week}`);
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Play/ }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(out, `island-${day}-${week}.png`), clip: { x: 0, y: 80, width: 390, height: 500 } });
  await page.close();
}
await browser.close();
server.close();
console.log('islands in recordings/look');
