// Records marketing/featuring.mp4: the real demo game being played, large, with the
// poster to open and close on. Reddit's limits for the featuring video: 3:2, 1000 to
// 1500 px wide, 6 to 15 seconds, under 3 MB.
//   npx vite build --config demo/vite.config.ts && node marketing/render.mjs && node marketing/video.mjs
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, '..', 'dist-demo');
const W = 1500;
const H = 1000;
const MAX_SECONDS = 14;
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => p && existsSync(p));
const ffmpeg = process.env.FFMPEG ?? (existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(site) || !existsSync(path)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath, headless: true, args: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

// An island that is cleared in two real pushes, with the most slimes to send flying.
const probe = await context.newPage();
let pick = null;
for (const day of ['Tue', 'Wed', 'Thu', 'Mon'])
  for (let week = 0; week < 30; week++) {
    await probe.goto(`${base}/game.html?s=fresh&day=${day}&week=${week}`);
    await probe.waitForFunction(() => window.__demo);
    const d = await probe.evaluate(() => ({ solution: window.__demo.solution, foes: window.__demo.foes, par: window.__demo.par }));
    const real = d.solution.filter((m) => m.p > 0);
    const tidy = d.solution.slice(0, real.length).every((m) => m.p > 0);
    if (tidy && real.length === 2 && d.par === d.foes && (!pick || d.foes > pick.foes)) pick = { day, week, moves: real, foes: d.foes };
  }
await probe.close();
if (!pick) throw new Error('no island cleared in two pushes');

const page = await context.newPage();
await page.goto(pathToFileURL(join(here, 'video.html')).href);
await page.evaluate((url) => window.V.load(url), `${base}/game.html?s=fresh&day=${pick.day}&week=${pick.week}`);
const game = page.frameLocator('#game');
await game.getByRole('button', { name: /^Play$/ }).waitFor();
await page.evaluate(() => document.fonts.ready);
const frame = page.frames().find((f) => f.url().includes('game.html'));
// Behind the poster: start the run and let the first-time hand finish its demonstration.
await game.getByRole('button', { name: /^Play$/ }).evaluate((el) => el.click()); // the poster is on top, so no pointer click
await page.waitForTimeout(3800);

// Board coordinates to page coordinates: the game publishes its board (data-board),
// and the frame is drawn at 1.5x inside the card.
const scene = game.locator('canvas.scene');
const toPage = async (x, y) => {
  const [bx, by, scale] = (await scene.getAttribute('data-board')).split(',').map(Number);
  const box = await page.locator('#game').boundingBox();
  const k = box.width / 390;
  return [box.x + (bx + x) * scale * k, box.y + (by + y) * scale * k, (bx + x) * scale, (by + y) * scale];
};
const mark = (x, y) =>
  frame.evaluate(({ x, y }) => {
    const el = document.createElement('div');
    el.className = 'demo-tap';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.append(el);
    setTimeout(() => el.remove(), 700);
  }, { x, y });
const UNIT = (d) => [Math.cos((d * Math.PI) / 36), Math.sin((d * Math.PI) / 36)];
const REACH = [0, 13, 25, 37, 49, 61, 74, 86, 98];
const aim = async (move) => {
  const you = JSON.parse(await scene.getAttribute('data-slimes'))[0];
  const [ux, uy] = UNIT(move.d);
  const [ax, ay, fx, fy] = await toPage(you.x + ux * 4, you.y + uy * 4);
  const [bx, by] = await toPage(you.x + ux * REACH[move.p], you.y + uy * REACH[move.p]);
  await mark(fx, fy);
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(bx, by, { steps: 22 });
  await page.waitForTimeout(200);
  await page.mouse.up();
};
const push = async () => {
  const button = game.locator('.push-row .btn.big');
  const box = await button.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await mark(box.x, box.y);
  await page.waitForTimeout(200);
  await button.evaluate((el) => el.click()); // a pointer click misses: the frame is drawn at 1.5x
};
const turnOver = () =>
  frame.waitForFunction(() => {
    const b = document.querySelector('.push-row .btn.big');
    return !b || b.disabled === false;
  }, null, { timeout: 60000 });

// ---- record ----
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  frames.push({ data, t: metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H });

await page.waitForTimeout(1100); // the poster
await page.evaluate(() => window.V.open());
await page.waitForTimeout(700);
await page.evaluate(() => window.V.say('DRAG', 'TO AIM'));
await aim(pick.moves[0]);
await page.waitForTimeout(700);
await page.evaluate(() => window.V.say('THEN', 'PUSH!', true));
await push();
await page.waitForTimeout(900);
await turnOver();
await page.waitForTimeout(300);
await aim(pick.moves[1]);
await page.waitForTimeout(350);
await push();
await game.getByRole('button', { name: /(try|play) again/i }).first().waitFor({ timeout: 60000 });
await page.evaluate(() => window.V.say('CLEAN', 'SWEEP!', true));
await page.waitForTimeout(1500);
await page.evaluate(() => window.V.close());
await page.waitForTimeout(2300);
const endT = Date.now() / 1000;
await cdp.send('Page.stopScreencast');
await browser.close();
server.close();

// ---- encode ----
const dir = join(tmpdir(), `pushover-feat-${process.pid}`);
mkdirSync(dir, { recursive: true });
const seconds = endT - frames[0].t;
const speed = Math.max(1, seconds / MAX_SECONDS); // only ever speeds up, and only to fit the limit
const lines = ['ffconcat version 1.0'];
frames.forEach((f, i) => {
  const name = `f${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
  lines.push(`file '${name}'`, `duration ${Math.max(0.001, ((frames[i + 1]?.t ?? endT) - f.t) / speed).toFixed(4)}`);
});
lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
const out = join(here, 'featuring.mp4');
const r = spawnSync(
  ffmpeg,
  ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', `fps=30,scale=${W}:${H}:flags=neighbor`, '-t', String(MAX_SECONDS + 0.4),
    '-c:v', 'libx264', '-preset', 'veryslow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out],
  { cwd: dir, encoding: 'utf8' }
);
rmSync(dir, { recursive: true, force: true });
if (r.status !== 0) throw new Error(r.stderr);
console.log(`${pick.day} week ${pick.week}, ${pick.foes} slimes; ${frames.length} frames, ${seconds.toFixed(1)}s recorded, x${speed.toFixed(2)}, ${(statSync(out).size / 1e6).toFixed(2)} MB`);
