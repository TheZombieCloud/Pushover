import { drawRows, spriteSize } from './sprites';

/*
 * The backdrop: a dithered sunset, a low sun, far-off islands, drifting clouds and
 * the three scalloped cloud banks the slimes fall into. The small clouds and the far
 * islands are hand-drawn sprites; the banks are built so they tile and scroll.
 */

type Ctx = CanvasRenderingContext2D;

const SKY = ['#1d1236', '#281646', '#3a1d55', '#542662', '#73306b', '#963c71', '#b94a72', '#d95e70', '#ee7a6f', '#f99d74', '#fdc184'];

export type CloudTones = { hi: string; base: string; shade: string };
export const CLOUD_FRONT: CloudTones = { hi: '#fff6ea', base: '#ffdcc8', shade: '#f6b9ad' };
export const CLOUD_MID: CloudTones = { hi: '#ffc6ba', base: '#ee9da6', shade: '#cf7f9c' };
export const CLOUD_BACK: CloudTones = { hi: '#d98aa5', base: '#b9698f', shade: '#96527f' };

const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
};

const sprite = (rows: string[], colors: Record<string, string>): HTMLCanvasElement => {
  const [w, h] = spriteSize(rows);
  const [c, ctx] = canvas(w, h);
  drawRows(ctx, rows, 0, 0, colors);
  return c;
};

// ---- hand-drawn pieces ----
// h lit top, b body, s shaded underside.
const CLOUDS = [
  [
    '...........hhhhh',
    '.........hhbbbbbhh',
    '....hhh.hbbbbbbbbbh....hhh',
    '...hbbbhhbbbbbbbbbbh..hbbbh',
    '..hbbbbbbbbbbbbbbbbbhhbbbbbh',
    '.hbbbbbbbbbbbbbbbbbbbbbbbbbbh',
    'hbbbbbbbbbbbbbbbbbbbbbbbbbbbbh',
    'hbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'sbbbbsssbbbbbbbssssbbbbbbsssbb',
    '.ssssssssssssssssssssssssssss',
  ],
  [
    '......hhhh',
    '....hhbbbbh...hh',
    '..hhbbbbbbbhhhbbh',
    '.hbbbbbbbbbbbbbbbh',
    'hbbbbbbbbbbbbbbbbbh',
    'sbbbsssbbbbbsssbbbs',
    '.sssssssssssssssss',
  ],
  [
    '...hhh',
    '.hhbbbhh..hh',
    'hbbbbbbbhhbbh',
    'sbbssbbbbbbbs',
    '.sssssssssss',
  ],
  [
    '.......hhhh',
    '.....hhbbbbhh',
    '..hhhbbbbbbbbh..hhh',
    '.hbbbbbbbbbbbbhhbbbh',
    'hbbbbbbbbbbbbbbbbbbbh',
    'hbbbbbbbbbbbbbbbbbbbbh',
    'sbbbbbssssbbbbbbsssbbs',
    '.ssssssssssssssssssss',
  ],
];

// Far islands, washed out by distance: t tree, h lit top, b rock, d rock in shade.
const FAR = [
  [
    '.......tt',
    '......tttt',
    '......tttt',
    '.......bb',
    '..hhhhhhhhhhhhhhhhhh',
    '.bbbbbbbbbbbbbbbbbbbb',
    '..bbbbbbbbbbbbbbbbbb',
    '...bbbdbbbbbbbbdbbb',
    '....bbdbbbbbbbddbb',
    '.....bddbbbbbddb',
    '......ddbbbbdd',
    '.......ddbbdd',
    '........dddd',
    '.........dd',
  ],
  [
    '..hhhhhhhhh',
    '.bbbbbbbbbbb',
    '..bbbbdbbbb',
    '...bbddbbb',
    '....bddbb',
    '.....ddb',
    '......d',
  ],
  [
    '....tt',
    '...tttt',
    '....bb',
    '.hhhhhhhhhhhh',
    'bbbbbbbbbbbbbb',
    '.bbbdbbbbbdbb',
    '..bddbbbbddb',
    '...ddbbbdd',
    '....dddd',
    '.....dd',
  ],
];
const FAR_HIGH = { t: '#6d3a78', h: '#7d4a86', b: '#532a68', d: '#42215a' };
const FAR_LOW = { t: '#a04a74', h: '#c25f7c', b: '#9a4573', d: '#82396b' };

// ---- sky ----
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A far-off island (0..2), in the colours of the high dark sky or the low warm sky. */
export const drawFarIsland = (ctx: Ctx, which: number, x: number, y: number, high: boolean) =>
  drawRows(ctx, FAR[which % FAR.length]!, x, y, high ? FAR_HIGH : FAR_LOW);

/** The sky, sun and stars. `far` adds the far-off islands where the game wants them. */
export const drawSky = (ctx: Ctx, w: number, h: number, horizon: number, far = true) => {
  const bands = SKY.length - 1;
  for (let y = 0; y < h; y++) {
    const t = Math.min(1, Math.pow(y / Math.max(1, horizon), 1.2)) * bands;
    const i = Math.floor(t);
    const f = t - i;
    for (let x = 0; x < w; x++) {
      const thr = (BAYER[(y % 4) * 4 + (x % 4)]! + 0.5) / 16;
      px(ctx, x, y, SKY[Math.min(bands, f > thr ? i + 1 : i)]!);
    }
  }
  // Stars: mostly single pixels, a few little crosses, only in the dark part.
  const n = Math.round((w * h) / 900);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(hash(i, 1, 3) * w);
    const y = Math.floor(Math.pow(hash(i, 2, 3), 1.8) * horizon * 0.5);
    px(ctx, x, y, '#fff1cf');
    if (i % 9 === 0) {
      px(ctx, x - 1, y, '#c9a2d8');
      px(ctx, x + 1, y, '#c9a2d8');
      px(ctx, x, y - 1, '#c9a2d8');
      px(ctx, x, y + 1, '#c9a2d8');
    }
  }
  // The sun, low on the horizon: a clean disc with two stepped halos.
  const sx = Math.round(w * 0.76);
  const sy = horizon - 34;
  for (let y = -30; y <= 30; y++)
    for (let x = -30; x <= 30; x++) {
      const d = Math.sqrt(x * x + y * y);
      const color = d <= 13 ? '#fff6d2' : d <= 16 ? '#ffe6a3' : d <= 22 ? '#fed295' : d <= 29 && (x + y) % 2 === 0 ? '#fdc184' : null;
      if (color) px(ctx, sx + x, sy + y, color);
    }
  if (!far) return;
  // Far islands, low in the sky where the board never covers them.
  drawRows(ctx, FAR[0]!, Math.round(w / 2) - 84, Math.round(horizon * 0.8), FAR_LOW);
  drawRows(ctx, FAR[2]!, Math.round(w / 2) - 8, Math.round(horizon * 0.9), FAR_LOW);
  if (w > 300) {
    drawRows(ctx, FAR[2]!, Math.round(w / 2) - 150, Math.round(horizon * 0.3), FAR_HIGH);
    drawRows(ctx, FAR[0]!, Math.round(w / 2) + 120, Math.round(horizon * 0.42), FAR_HIGH);
  }
};

// ---- clouds ----
export const cloudSprites = (): HTMLCanvasElement[] =>
  CLOUDS.map((rows) => sprite(rows, { h: CLOUD_FRONT.hi, b: CLOUD_FRONT.base, s: CLOUD_FRONT.shade }));

/** One tileable strip of scalloped cloud tops, solid below. */
export const makeBank = (tile: number, h: number, seed: number, tones: CloudTones): HTMLCanvasElement => {
  const [c, ctx] = canvas(tile, h);
  const blobs: [number, number, number][] = [];
  for (let x = 0; x < tile; ) {
    const r = 7 + Math.floor(hash(seed, x) * 8);
    blobs.push([x, r + 2 + Math.floor(hash(seed, x, 2) * 5), r]);
    x += Math.round(r * (1.1 + hash(seed, x, 3) * 0.5));
  }
  const tops = Array.from({ length: tile }, (_, x) =>
    Math.min(
      20,
      ...blobs.map(([bx, by, r]) => {
        // Wrap so the strip tiles.
        const dx = Math.min(Math.abs(x - bx), tile - Math.abs(x - bx));
        return dx <= r ? by - Math.sqrt(r * r + r * 0.5 - dx * dx) : 20;
      })
    )
  );
  // Lit along the top contour, shaded low down.
  for (let x = 0; x < tile; x++) {
    const top = Math.round(tops[x]!);
    for (let y = top; y < h; y++) {
      const depth = y - top;
      px(ctx, x, y, depth < 2 ? tones.hi : depth >= 14 ? tones.shade : tones.base);
    }
  }
  return c;
};
