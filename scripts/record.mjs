// Records scripted playthroughs of the demo build (demo/ + mock backend) as MP4s, plus stills,
// and writes recordings/index.html to watch them all.
//
//   npm run record                  # build demo, record every scenario
//   npm run record -- detour home   # only scenarios whose name contains one of these words
//
// Needs Chrome or Edge (or CHROME_PATH) and ffmpeg on PATH (or FFMPEG).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const site = join(root, 'dist-demo');
const out = join(root, 'recordings');
const filters = process.argv.slice(2).map((f) => f.toLowerCase());

// ---- tools ----
const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
const ffmpeg = process.env.FFMPEG ?? (existsSync('C:/ffmpeg/bin/ffmpeg.exe') ? 'C:/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg');
if (spawnSync(ffmpeg, ['-version']).status !== 0) throw new Error('ffmpeg not found. Install it or set FFMPEG.');
if (!existsSync(join(site, 'game.html'))) throw new Error('dist-demo missing. Run: npm run record (it builds first).');

// ---- static server for dist-demo ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(site) || !existsSync(path)) return void res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---- recording helpers ----
const PHONE = { width: 390, height: 844 };
const FEED = { width: 390, height: 520 };

const makeActions = (page, stills, name, captions) => {
  const tapMarker = async (locator) => {
    const box = await locator.boundingBox();
    if (!box) return;
    await page.evaluate(({ x, y }) => {
      const el = document.createElement('div');
      el.className = 'demo-tap';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      document.body.append(el);
      setTimeout(() => el.remove(), 700);
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  };
  const a = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    demo: () => page.evaluate(() => window.__demo),
    async tap(locator, after = 900) {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await tapMarker(locator);
      await locator.tap();
      await page.waitForTimeout(after);
    },
    button: (text) => page.getByRole('button', { name: text }).first(),
    async scrollThrough(step = 260, pause = 700) {
      for (let i = 0; i < 12; i++) {
        const atEnd = await page.evaluate(() => window.innerHeight + window.scrollY >= document.body.scrollHeight - 4);
        if (atEnd) break;
        await page.mouse.wheel(0, step);
        await page.waitForTimeout(pause);
      }
    },
    async scrollTop() {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(700);
    },
    /** Caption shown beside the phone from now until the next one (captioned video only). */
    caption(text) {
      captions.push({ t: Date.now() / 1000, text });
    },
    async still(label) {
      const file = `${name}-${String(stills.length + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: join(out, file) });
      stills.push({ file, label });
    },
  };
  return a;
};

const encode = (frames, endT, file) => {
  const dir = join(tmpdir(), `pushover-rec-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? endT;
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, next - f.t).toFixed(4)}`);
  });
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { cwd: dir, encoding: 'utf8' }
  );
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

// Captioned version for sharing: 1920x1080, the phone on the left, the current caption on the right.
const fontUrl = (pkg, w) => pathToFileURL(join(root, `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`)).href;
const encodeCaptioned = async (browser, frames, endT, captions, file) => {
  const dir = join(tmpdir(), `pushover-cap-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const t0 = frames[0].t;
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const caps = ['ffconcat version 1.0'];
  for (const [i, c] of captions.entries()) {
    const html = join(dir, `c${i}.html`);
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:HEAD;font-weight:700;src:url(${fontUrl('silkscreen', 700)})}
@font-face{font-family:PX;font-weight:400;src:url(${fontUrl('tiny5', 400)})}
*{margin:0;box-sizing:border-box}body{width:1920px;height:1080px;background:#1d1236;position:relative}
.frame{position:absolute;left:232px;top:22px;width:498px;height:1036px;border-radius:26px;background:#0b0716}
.side{position:absolute;left:860px;right:120px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.brand{font:700 40px HEAD;letter-spacing:.12em;color:#ffcd3c;margin-bottom:34px}
p{font:400 72px/1.15 PX;color:#fff3e3}
</style><div class="frame"></div><div class="side"><div class="brand">PUSHOVER</div><p>${c.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p></div>`
    );
    await page.goto(pathToFileURL(html).href);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(dir, `c${i}.png`) });
    const from = i === 0 ? t0 : c.t;
    const to = captions[i + 1]?.t ?? endT;
    caps.push(`file 'c${i}.png'`, `duration ${Math.max(0.05, to - from).toFixed(3)}`);
  }
  caps.push(`file 'c${captions.length - 1}.png'`);
  writeFileSync(join(dir, 'caps.txt'), caps.join('\n'));
  await page.close();
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    lines.push(`file '${name}'`, `duration ${Math.max(0.001, (frames[i + 1]?.t ?? endT) - f.t).toFixed(4)}`);
  });
  lines.push(`file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'`);
  writeFileSync(join(dir, 'list.txt'), lines.join('\n'));
  const r = spawnSync(
    ffmpeg,
    ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'caps.txt', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-filter_complex', '[0:v]fps=30[bg];[1:v]fps=30,scale=462:1000[ph];[bg][ph]overlay=250:40:shortest=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { cwd: dir, encoding: 'utf8' }
  );
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};

// ---- scenarios ----
// Pushover scenarios. Scripted runs first read today's stored solution from the mock
// (window.__demo), then reload with ?auto=<moves> so the game aims and pushes by itself.
const withAuto = async (a, url, pick) => {
  const { solution } = await a.demo();
  const moves = pick(solution);
  await a.page.goto(`${base}/${url}&auto=${encodeURIComponent(JSON.stringify(moves))}`);
  await a.wait(900);
};

const untilResults = (a) => a.page.getByRole('button', { name: /(try|play) again/i }).first().waitFor({ timeout: 120000 });
const turnOver = (a) =>
  a.page.waitForFunction(() => {
    const b = document.querySelector('.push-row .btn.big');
    return !b || b.disabled === false;
  }, null, { timeout: 60000 });

// Driving the canvas like a finger: board coordinates to page coordinates come from
// what the canvas publishes (data-board), and each touch leaves the tap marker.
const boardPoint = async (a, x, y) => {
  const [bx, by, scale] = (await a.page.locator('canvas.scene').getAttribute('data-board')).split(',').map(Number);
  return [(bx + x) * scale, (by + y) * scale];
};
const mark = (a, x, y) =>
  a.page.evaluate(({ x, y }) => {
    const el = document.createElement('div');
    el.className = 'demo-tap';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    document.body.append(el);
    setTimeout(() => el.remove(), 700);
  }, { x, y });
const boardTap = async (a, x, y, after = 500) => {
  const [px, py] = await boardPoint(a, x, y);
  await mark(a, px, py);
  await a.page.mouse.click(px, py);
  await a.wait(after);
};
const boardDrag = async (a, x0, y0, x1, y1, after = 600) => {
  const [ax, ay] = await boardPoint(a, x0, y0);
  const [bx, by] = await boardPoint(a, x1, y1);
  await mark(a, ax, ay);
  await a.page.mouse.move(ax, ay);
  await a.page.mouse.down();
  await a.page.mouse.move(bx, by, { steps: 24 });
  await a.wait(250);
  await a.page.mouse.up();
  await a.wait(after);
};
const UNIT = (d) => [Math.cos((d * Math.PI) / 36), Math.sin((d * Math.PI) / 36)];
const REACH = { grass: [0, 13, 25, 37, 49, 61, 74, 86, 98], ice: [0, 22, 43, 64, 85, 106, 128, 149, 170] };
const slimesNow = async (a) => JSON.parse(await a.page.locator('canvas.scene').getAttribute('data-slimes'));
/** Aim your slime by dragging from it, the way a player would. */
const aimByDrag = async (a, move, ice = false) => {
  const you = (await slimesNow(a))[0];
  const [ux, uy] = UNIT(move.d);
  const far = REACH[ice ? 'ice' : 'grass'][move.p];
  await boardDrag(a, you.x + ux * 4, you.y + uy * 4, you.x + ux * far, you.y + uy * far);
};

const SCENARIOS = [
  {
    name: 'demo',
    title: 'Demo video (captioned)',
    note: 'The submission video: one run from the title to the results, the leaderboard, and a look at the island editor. The captioned version is demo-captioned.mp4.',
    url: 'game.html?s=fresh&day=Tue',
    run: async (a) => {
      const page = a.page;
      // A Tuesday whose solution is real pushes all the way (no turn spent standing still),
      // with more than one kind of foe to talk about.
      let pick = null;
      for (let week = 0; week < 30 && !pick; week++) {
        await page.goto(`${base}/game.html?s=fresh&day=Tue&week=${week}`);
        await a.wait(200);
        const d = await a.demo();
        const pushes = d.solution.findIndex((m) => m.p === 0);
        const real = pushes < 0 ? d.solution.length : pushes;
        if (real >= 2 && d.solution.slice(real).every((m) => m.p === 0) && d.kinds >= 2) pick = { week, moves: d.solution.slice(0, real) };
      }
      if (!pick) throw new Error('no suitable Tuesday for the demo');
      await page.goto(`${base}/game.html?s=fresh&day=Tue&week=${pick.week}`);
      await a.wait(800);
      const { foes, turns } = await a.demo();
      const solution = pick.moves;
      a.caption(`Today’s island. I’ve got ${turns} turns to push all ${foes} slimes off it.`);
      await a.wait(3200);
      await a.tap(a.button(/^Play$/), 3400);
      a.caption('I drag from my slime to aim. The arrows are what the other slimes are about to do.');
      await aimByDrag(a, solution[0]);
      await a.wait(2600);
      a.caption('When I press push they all move at the same time.');
      await a.tap(page.locator('.push-row .btn.big'), 1600);
      await turnOver(a);
      await a.wait(700);
      if (await page.getByRole('button', { name: 'Who’s who' }).count()) {
        a.caption('There are 4 kinds of slime. Chasers charge at me and dodgers run away.');
        await a.tap(page.getByRole('button', { name: 'Who’s who' }), 3800);
        await a.tap(a.button(/Got it/), 700);
      }
      a.caption('I just keep pushing until they’re all off or I run out of turns.');
      for (const move of solution.slice(1)) {
        if (!(await page.locator('.push-row .btn.big').count())) break;
        await aimByDrag(a, move);
        await a.wait(1100);
        await a.tap(page.locator('.push-row .btn.big'), 1600);
        await turnOver(a);
        await a.wait(600);
      }
      await untilResults(a);
      a.caption(`Got all ${foes}. If I’d fallen off the run would be over but I’d keep my score.`);
      await a.wait(4200);
      a.caption('The leaderboard is most slimes first, then whoever took fewer runs.');
      await a.tap(a.button(/^Leaders$/), 3600);
      await a.tap(page.getByRole('button', { name: 'Close' }), 900);
      a.caption('I can also build my own island and post it for other people to play.');
      await a.tap(a.button(/Build your own island/), 1600);
      await a.tap(a.button(/^Shuffle$/), 1100);
      await a.tap(a.button(/^Shuffle$/), 1300);
      const draft = await page.evaluate(() => window.__draft);
      await a.tap(page.getByRole('button', { name: 'Foes' }), 600);
      if (draft.foes[0]) {
        await boardTap(a, draft.foes[0].x, draft.foes[0].y, 1200);
        await boardTap(a, draft.foes[0].x, draft.foes[0].y, 1400);
      }
      a.caption('There’s a new island every day and they get harder through the week.');
      await a.wait(4200);
    },
  },
  {
    name: 'feed-card',
    title: 'Feed card',
    note: 'What people see scrolling past the post: today’s island, live, with every foe’s first move.',
    url: 'splash.html?s=fresh&day=Wed',
    size: FEED,
    run: async (a) => {
      await a.wait(1800);
      await a.still('Feed card');
      await a.wait(2500);
    },
  },
  {
    name: 'first-play',
    title: 'First play (Monday)',
    note: 'A new player: the hand shows the drag once, then real drags and pushes through to the results.',
    url: 'game.html?s=fresh&day=Mon',
    run: async (a) => {
      await a.wait(1200);
      const { solution } = await a.demo();
      await a.still('Title');
      await a.tap(a.button(/^Play$/), 3200);
      await a.still('The hand shows the drag');
      for (const [i, move] of solution.entries()) {
        if (!(await a.page.locator('.push-row .btn.big').count())) break;
        await aimByDrag(a, move);
        if (i === 0) await a.still('Aimed');
        await a.tap(a.page.locator('.push-row .btn.big'), 1600);
        if (i === 0) await a.still('Sliding');
        await turnOver(a);
        await a.wait(500);
      }
      await untilResults(a);
      await a.wait(900);
      await a.still('Results');
      await a.wait(1200);
    },
  },
  {
    name: 'boulders',
    title: 'Boulders (Wednesday)',
    note: 'Slimes bounce off the boulders, and arrows bend to show it.',
    url: 'game.html?s=fresh&day=Wed',
    run: async (a) => {
      await withAuto(a, 'game.html?s=fresh&day=Wed', (sol) => sol);
      await a.still('Title');
      await a.wait(1200);
      await a.tap(a.button(/^Play$/), 1300);
      await a.still('Aiming');
      await a.wait(2600);
      await a.still('Sliding');
      await untilResults(a);
      await a.wait(800);
      await a.still('Results');
    },
  },
  {
    name: 'frozen',
    title: 'Frozen (Friday)',
    note: 'Ice: the same push carries much further.',
    url: 'game.html?s=fresh&day=Fri',
    run: async (a) => {
      await withAuto(a, 'game.html?s=fresh&day=Fri', (sol) => sol);
      await a.still('Title');
      await a.wait(1200);
      await a.tap(a.button(/^Play$/), 1300);
      await a.still('Aiming');
      await a.wait(2600);
      await a.still('Sliding');
      await untilResults(a);
      await a.wait(800);
      await a.still('Results');
    },
  },
  {
    name: 'sunday',
    title: 'Frozen boulders (Sunday)',
    note: 'The hardest day: six foes, four turns, ice and boulders.',
    url: 'game.html?s=fresh&day=Sun',
    run: async (a) => {
      await withAuto(a, 'game.html?s=fresh&day=Sun', (sol) => sol);
      await a.still('Title');
      await a.tap(a.button(/^Play$/), 600);
      await a.wait(4500);
      await a.still('Mid-turn');
      await untilResults(a);
      await a.wait(800);
      await a.still('Results');
    },
  },
  {
    name: 'oops',
    title: 'Falling off',
    note: 'Aiming yourself off the edge: the run ends there, then try again.',
    url: 'game.html?s=fresh&day=Tue',
    run: async (a) => {
      const { fallMove } = await a.demo();
      await withAuto(a, 'game.html?s=fresh&day=Tue', () => [fallMove]);
      await a.tap(a.button(/^Play$/), 600);
      await a.wait(4200);
      await a.still('Sliding off');
      await untilResults(a);
      await a.wait(800);
      await a.still('Results after falling');
      await a.tap(a.button(/Try again/), 1500);
      await a.still('Fresh run');
    },
  },
  {
    name: 'replay',
    title: 'Coming back: results, replay, leaderboard',
    note: 'Someone who already played: their results, their best run played back, then the leaderboard.',
    url: 'game.html?s=played&day=Thu',
    run: async (a) => {
      await a.wait(1500);
      await a.still('Results');
      await a.tap(a.button(/^Replay$/), 3200);
      await a.still('Replay');
      await untilResults(a);
      await a.wait(700);
      await a.tap(a.button(/^Leaders$/), 1500);
      await a.still('Leaderboard');
    },
  },
  {
    name: 'editor',
    title: 'Building and posting an island',
    note: 'Shape the island, place a boulder, pick each foe’s kind, play it through, and post it.',
    url: 'game.html?s=played&day=Mon',
    run: async (a) => {
      const page = a.page;
      const draftNow = () => page.evaluate(() => window.__draft);
      await a.wait(1200);
      await a.tap(a.button(/Build your own island/), 1200);
      // An island that can be beaten (shuffle until there is one).
      let plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
      for (let i = 0; i < 8 && plan.outs === 0; i++) {
        await a.tap(a.button(/^Shuffle$/), 700);
        plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
      }
      await a.still('A fresh island');
      let draft = await draftNow();
      // A boulder, grown with a second tap.
      await a.tap(page.getByRole('button', { name: 'Boulders' }), 500);
      for (const [dx, dy] of [[26, 26], [-26, 26], [26, -26], [-26, -26], [0, 32], [32, 0]]) {
        await boardTap(a, draft.you.x + dx, draft.you.y + dy, 350);
        if ((await draftNow()).rocks.length > 0) break;
      }
      const rock = (await draftNow()).rocks[0];
      if (rock) await boardTap(a, rock.x, rock.y, 600);
      // Cut a notch out of the far edge.
      await a.tap(page.getByRole('button', { name: 'Cut away' }), 500);
      await boardDrag(a, 30, 18, 140, 26, 700);
      await a.still('Shaped, with a boulder');
      // Change a foe's kind with a tap.
      await a.tap(page.getByRole('button', { name: 'Foes' }), 500);
      draft = await draftNow();
      const pick = draft.foes[0];
      if (pick) {
        await boardTap(a, pick.x, pick.y, 900);
        await a.still('A foe changes kind');
      }
      // Play it through with a line that works on the island as it now stands.
      plan = await page.evaluate(() => window.__demo.solveDraft(window.__draft));
      draft = await draftNow();
      await a.tap(a.button(/Play it through/), 1400);
      await a.still('Playing it through');
      for (const move of plan.moves) {
        if (!(await page.locator('.push-row .btn.big').count())) break;
        if (move.p > 0) await aimByDrag(a, move, draft.ice);
        await a.wait(600);
        await a.tap(page.locator('.push-row .btn.big'), 1200);
        await turnOver(a);
        await a.wait(500);
      }
      for (let t = 0; t < 5 && (await page.locator('.push-row .btn.big').count()); t++) {
        await a.tap(page.locator('.push-row .btn.big'), 800);
        await turnOver(a);
        await a.wait(500);
      }
      await a.button(/Play again/).waitFor({ timeout: 30000 });
      await a.wait(900);
      await a.still('Ready to post');
      if (await page.getByRole('button', { name: /Post island/ }).count()) {
        await a.tap(a.button(/Post island/), 2200);
        await a.still('Posted');
      }
    },
  },
  {
    name: 'hole',
    title: 'Falling down a hole',
    note: 'Sliding into a hole in the middle of the island: you drop away through it.',
    url: 'game.html?s=fresh&day=Mon',
    run: async (a) => {
      // Find an island with a hole you can reach in one push.
      let found = null;
      for (const day of ['Mon', 'Tue', 'Thu', 'Sat']) {
        for (let week = 0; week < 12 && !found; week++) {
          await a.page.goto(`${base}/game.html?s=fresh&day=${day}&week=${week}`);
          await a.wait(250);
          const move = (await a.demo()).holeMove;
          if (move) found = { day, week, move };
        }
        if (found) break;
      }
      if (!found) throw new Error('no island with a reachable hole');
      await a.page.evaluate(() => localStorage.setItem('pushover:aimed', '1'));
      await a.page.goto(`${base}/game.html?s=fresh&day=${found.day}&week=${found.week}&auto=${encodeURIComponent(JSON.stringify([found.move]))}`);
      await a.wait(900);
      await a.tap(a.button(/^Play$/), 600);
      // Catch the drop itself: a still every third of a second while the turn plays.
      for (let i = 0; i < 12; i++) {
        await a.wait(150);
        await a.still(`Drop ${i + 1}`);
      }
      await untilResults(a);
    },
  },
  {
    name: 'legend',
    title: 'Who’s who',
    note: 'The ? button names each kind of foe on the island in one line.',
    url: 'game.html?s=fresh&day=Thu',
    run: async (a) => {
      await a.page.evaluate(() => localStorage.setItem('pushover:aimed', '1'));
      await a.wait(1000);
      await a.tap(a.button(/^Play$/), 1500);
      await a.still('The island');
      await a.tap(a.page.getByRole('button', { name: 'Who’s who' }), 1200);
      await a.still('Who’s who');
      await a.tap(a.button(/Got it/), 800);
    },
  },
];

// ---- run ----
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--hide-scrollbars'] });
const done = [];
const chosen = SCENARIOS.filter((s) => !filters.length || filters.some((f) => s.name.includes(f)));
for (const s of chosen) {
  const size = s.size ?? PHONE;
  const context = await browser.newContext({ viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: size.width * 2, maxHeight: size.height * 2 });
  await page.goto(`${base}/${s.url}`);
  const stills = [];
  const captions = [];
  process.stdout.write(`recording ${s.name}… `);
  try {
    await s.run(makeActions(page, stills, s.name, captions));
    await page.waitForTimeout(800);
  } catch (e) {
    console.log(`FAILED: ${e.message.split('\n')[0]}`);
  }
  const endT = Date.now() / 1000;
  await cdp.send('Page.stopScreencast');
  await context.close();
  if (!frames.length) {
    console.log('no frames');
    continue;
  }
  encode(frames, endT, join(out, `${s.name}.mp4`));
  if (captions.length) await encodeCaptioned(browser, frames, endT, captions, join(out, `${s.name}-captioned.mp4`));
  done.push({ ...s, stills, seconds: Math.round(endT - frames[0].t) });
  console.log(`${Math.round(endT - frames[0].t)}s, ${stills.length} stills`);
}
await browser.close();
server.close();

// ---- gallery (keeps entries for scenarios not re-recorded this run) ----
const manifestPath = join(out, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const merged = SCENARIOS.map((s) => done.find((d) => d.name === s.name) ?? previous.find((p) => p.name === s.name)).filter(Boolean)
  .map(({ run, size, ...rest }) => rest);
writeFileSync(manifestPath, JSON.stringify(merged, null, 2));

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const stamp = new Date().toLocaleString('en-GB');
writeFileSync(
  join(out, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pushover recordings</title>
<style>
:root{color-scheme:dark;--bg:#0f1216;--card:#1b2129;--line:#2b333d;--text:#f1f3f5;--muted:#9aa4b0}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:22px}.sub{color:var(--muted);margin:0 0 24px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px}
.card h2{margin:0;font-size:16px}.card p{margin:0;color:var(--muted);font-size:14px}
video{width:100%;border-radius:10px;background:#000}
.stills{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.stills a{flex:none;width:78px;color:var(--muted);font-size:11px;text-decoration:none}
.stills img{width:78px;border-radius:6px;display:block;margin-bottom:4px;border:1px solid var(--line)}
code{background:#000;padding:1px 6px;border-radius:5px}
</style></head><body><main>
<h1>Pushover recordings</h1>
<p class="sub">Updated ${esc(stamp)} · local demo build with mock data (fake players and crowd stats) · re-record with <code>npm run record</code></p>
<div class="grid">
${merged
  .map(
    (s) => `<section class="card"><h2>${esc(s.title)}</h2><p>${esc(s.note)} · ${s.seconds}s</p>
<video src="${s.name}.mp4" controls muted playsinline preload="metadata"${s.stills[0] ? ` poster="${s.stills[0].file}"` : ''}></video>
<div class="stills">${s.stills.map((st) => `<a href="${st.file}" target="_blank"><img src="${st.file}" alt="${esc(st.label)}">${esc(st.label)}</a>`).join('')}</div></section>`
  )
  .join('\n')}
</div></main></body></html>`
);
console.log(`\nOpen ${join(out, 'index.html')}`);
