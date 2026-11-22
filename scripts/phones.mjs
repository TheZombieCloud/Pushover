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

// Stills at common phone sizes, to check the island and UI fill the screen.
const browser = await chromium.launch({ executablePath: browserPath });
const PHONES = [['360x740@3', 360, 740, 3], ['375x667@2', 375, 667, 2], ['412x915@2.625', 412, 915, 2.625], ['390x844@3', 390, 844, 3], ['360x560@3', 360, 560, 3]];
for (const [name, width, height, dpr] of PHONES) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/game.html?s=fresh&day=Thu`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(out, `phone-${name}-title.png`) });
  await page.getByRole('button', { name: /^Play/ }).click();
  await page.waitForTimeout(1300);
  await page.screenshot({ path: join(out, `phone-${name}-play.png`) });
  const px = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--px'));
  const over = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight);
  console.log(name, 'art pixel =', px, 'css px; island', Math.round(176 * parseFloat(px)), 'of', width, 'wide; overflow', over);
  await ctx.close();
}
await browser.close();
server.close();
