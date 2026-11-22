// Builds the submission gallery (docs/gallery) from the recorder's stills:
// four 3:2 images, each three phone screens with a heading and a line under each.
// Run `npm run record` first so the stills are current, then `npm run gallery`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'recordings');
const out = join(root, 'docs/gallery');

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!browserPath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');

// Each screen is [scenario, still label, line under it].
const PAGES = [
  {
    file: '1-how-to-play.png',
    title: 'How to play',
    screens: [
      ['first-play', 'Title', 'A new island every day'],
      ['first-play', 'Aimed', 'Drag to aim, then push'],
      ['legend', 'Who’s who', 'Every slime has a habit'],
    ],
  },
  {
    file: '2-the-week.png',
    title: 'Every day plays differently',
    screens: [
      ['boulders', 'Aiming', 'Wednesday has boulders'],
      ['frozen', 'Aiming', 'Friday is frozen'],
      ['sunday', 'Title', 'Sunday has both'],
    ],
  },
  {
    file: '3-results.png',
    title: 'After a run',
    screens: [
      ['first-play', 'Results', 'How you did, and everyone else'],
      ['replay', 'Leaderboard', 'Fewest runs wins a tie'],
      ['replay', 'Replay', 'Watch your best run again'],
    ],
  },
  {
    file: '4-build-your-own.png',
    title: 'Build your own island',
    screens: [
      ['editor', 'Shaped, with a boulder', 'Shape it and place boulders'],
      ['editor', 'A foe changes kind', 'Pick each slime’s habit'],
      ['editor', 'Ready to post', 'Beat it, then post it'],
    ],
  },
];

const manifest = JSON.parse(readFileSync(join(shots, 'manifest.json'), 'utf8'));
const still = (scenario, label) => {
  const s = manifest.find((m) => m.name === scenario);
  const hit = s?.stills?.find((x) => x.label === label);
  if (!hit) throw new Error(`no still "${label}" in ${scenario}. Run npm run record first.`);
  return pathToFileURL(join(shots, hit.file)).href;
};
const font = (pkg, w) => pathToFileURL(join(root, `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`)).href;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath, headless: true });
const page = await browser.newPage({ viewport: { width: 2400, height: 1600 } });
for (const p of PAGES) {
  const html = join(tmpdir(), `pushover-gallery-${process.pid}.html`);
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:HEAD;font-weight:700;src:url(${font('silkscreen', 700)})}
@font-face{font-family:PX;font-weight:400;src:url(${font('tiny5', 400)})}
*{margin:0;box-sizing:border-box}
body{width:2400px;height:1600px;background:#1d1236;display:flex;flex-direction:column;align-items:center}
h1{font:700 76px HEAD;letter-spacing:.06em;color:#ffcd3c;margin-top:56px;text-shadow:0 6px 0 #2a1630}
.row{display:flex;gap:110px;margin-top:52px}
.screen{display:flex;flex-direction:column;align-items:center}
.screen img{width:564px;height:1220px;display:block;border:6px solid #2a1630;border-radius:30px;image-rendering:pixelated;background:#0b0716}
.screen p{font:400 54px/1.1 PX;color:#fff3e3;margin-top:30px}
</style><h1>${esc(p.title)}</h1><div class="row">${p.screens
      .map(([scenario, label, line]) => `<div class="screen"><img src="${still(scenario, label)}"><p>${esc(line)}</p></div>`)
      .join('')}</div>`
  );
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(out, p.file) });
  console.log(`wrote docs/gallery/${p.file}`);
}
await browser.close();
