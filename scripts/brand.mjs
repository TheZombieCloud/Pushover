// Renders the subreddit icon and banner with the game's own renderer:
//   npx vite build --config demo/vite.config.ts && node scripts/brand.mjs
// Writes docs/brand/pushover-icon.png (512 x 512) and pushover-banner.png (1920 x 384).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist-demo');
const out = join(root, 'docs', 'brand');
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

const browser = await chromium.launch({ executablePath: browserPath });
const page = await browser.newPage({ viewport: { width: 1960, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/brand.html`);
await page.waitForSelector('body[data-ready="1"]');
await page.locator('#icon').screenshot({ path: join(out, 'pushover-icon.png') });
await page.locator('#banner').screenshot({ path: join(out, 'pushover-banner.png') });
await browser.close();
server.close();
console.log('wrote docs/brand/pushover-icon.png and pushover-banner.png');
