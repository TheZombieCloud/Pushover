// Renders the catalog stills with the game's own renderer (src/client/brand.ts):
//   npx vite build --config demo/vite.config.ts && node marketing/render.mjs
// Writes marketing/icon.png (1024 x 1024), featuring.png (1500 x 1000), tile.png (1760 x 800)
// and backdrop.png (behind the video), and copies the icon to assets/icon.png for devvit.json.
import { createServer } from 'node:http';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const site = join(root, 'dist-demo');
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
const page = await browser.newPage({ viewport: { width: 1960, height: 1100 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/brand.html`);
await page.waitForSelector('body[data-ready="1"]');
for (const [id, file] of [['icon-large', 'icon'], ['featuring', 'featuring'], ['tile', 'tile'], ['backdrop', 'backdrop']])
  await page.locator(`#${id}`).screenshot({ path: join(here, `${file}.png`) });
await browser.close();
server.close();
mkdirSync(join(root, 'assets'), { recursive: true });
copyFileSync(join(here, 'icon.png'), join(root, 'assets', 'icon.png'));
console.log('wrote marketing/icon.png, featuring.png, tile.png, backdrop.png and assets/icon.png');
