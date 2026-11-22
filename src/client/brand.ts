import { makeIsland } from './island';
import { CLOUD_FRONT, CLOUD_MID, cloudSprites, makeBank } from './sky';
import { FOES, YOU, drawSlime } from './sprites';
import type { Face, FrameName, Ramp } from './sprites';

/*
 * Brand images for the subreddit and the app listing. Not part of the game: the
 * demo build serves this page (demo/brand.html) and scripts/brand.mjs screenshots
 * each canvas into docs/brand.
 *
 * Both share one idea and one pixel size: your slime, big, crowned and smug, on a
 * sunburst, with the foes it has just sent flying. The foes are the game's own
 * sprites; the big slime is drawn here, pixel by pixel.
 */

type Ctx = CanvasRenderingContext2D;

const INK = '#1a1026';
const GOLD = '#ffd23f';

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

/** A canvas of w x h art pixels shown at `scale` times that size, with crisp pixels. */
const artboard = (id: string, w: number, h: number, scale: number): Ctx => {
  const canvas = document.createElement('canvas');
  canvas.id = id;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = `${w * scale}px`;
  canvas.style.height = `${h * scale}px`;
  canvas.style.imageRendering = 'pixelated';
  canvas.style.display = 'block';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return ctx;
};

/** Alternating rays out from (ox, oy), brighter inside `glow`. */
const sunburst = (ctx: Ctx, w: number, h: number, ox: number, oy: number, glow: number) => {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ray = Math.floor(((Math.atan2(y - oy, x - ox) + Math.PI) / (Math.PI * 2)) * 16 + 0.5) % 2;
      const near = Math.sqrt((x - ox) ** 2 + (y - oy) ** 2) < glow;
      px(ctx, x, y, ray ? (near ? '#b94a72' : '#73306b') : near ? '#963c71' : '#542662');
    }
};

/**
 * The big slime, its top at `top`, with face and crown. On the ground it is a wide
 * dome looking smug; `leap` makes it taller with a rounded underside and an open,
 * delighted mouth, for mid-jump.
 */
const king = (ctx: Ctx, cx: number, top: number, leap = false) => {
  const w = leap ? 42 : 46;
  const h = leap ? 40 : 35;
  const inside = (x: number, y: number) => {
    const i = y - top;
    if (i < 0 || i >= h) return false;
    const t = (i + 0.5) / h;
    const half = t < 0.7 ? (w / 2) * Math.sqrt(Math.max(0, 1 - ((0.7 - t) / 0.7) ** 2)) : (w / 2) * (1 - ((t - 0.7) / 0.3) ** 2 * (leap ? 0.45 : 0.1));
    return Math.abs(x + 0.5 - cx) <= half;
  };
  const edge = (x: number, y: number) => {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dy) <= 3 && !inside(x + dx, y + dy)) return true;
    return false;
  };
  if (!leap) {
    // Shadow on the ground.
    ctx.fillStyle = 'rgba(26, 16, 38, 0.45)';
    ctx.fillRect(cx - 21, top + h - 1, 42, 2);
    ctx.fillRect(cx - 18, top + h + 1, 36, 1);
  }
  for (let y = top; y < top + h; y++)
    for (let x = cx - w / 2 - 1; x <= cx + w / 2 + 1; x++) {
      if (!inside(x, y)) continue;
      const u = (x - cx) / (w / 2);
      const v = (y - top) / h;
      let color = YOU.b;
      if (v > 0.8 || u > 0.62 + (0.5 - v) * 0.3) color = YOU.d;
      if (u < -0.15 && v < 0.42 && u + v < 0.12) color = YOU.l;
      // The glint low on the far side, the way light passes through jelly.
      if (v > 0.72 && v < 0.86 && u > 0.18 && u < 0.62 && u - v < -0.3) color = YOU.l;
      if (edge(x, y)) color = INK;
      px(ctx, x, y, color);
    }
  // Shine.
  px(ctx, cx - 15, top + 7, '#ffffff', 6, 3);
  px(ctx, cx - 17, top + 9, '#ffffff', 3, 4);
  px(ctx, cx - 16, top + 15, '#ffffff', 2, 2);

  // Face: big eyes with glints, set brows, a one-sided grin, a blush.
  const ey = top + (leap ? 16 : 15);
  for (const side of [-1, 1]) {
    const ex = cx + side * 9 - 2;
    px(ctx, ex, ey + 1, INK, 5, 8);
    px(ctx, ex + 1, ey, INK, 3, 10);
    px(ctx, ex + 1, ey + 1, '#ffffff', 2, 3);
    px(ctx, ex + 3, ey + 6, '#ffffff', 1, 1);
    // Brows, lower at the inside: it means business. None when it's just happy.
    if (!leap) for (let k = 0; k < 7; k++) px(ctx, ex - 1 + (side < 0 ? k : 6 - k), ey - 5 + Math.floor(k / 2), INK, 1, 2);
    px(ctx, cx + side * 15 - 2, ey + 11, YOU.cheek, 5, 2);
  }
  if (leap) {
    // Mouth wide open: teeth along the top, tongue at the bottom.
    px(ctx, cx - 6, ey + 11, INK, 13, 8);
    px(ctx, cx - 5, ey + 19, INK, 11, 1);
    px(ctx, cx - 7, ey + 11, INK, 15, 2);
    px(ctx, cx - 5, ey + 12, '#ffffff', 11, 2);
    px(ctx, cx - 4, ey + 15, '#7a1f3d', 9, 4);
    px(ctx, cx - 3, ey + 16, '#ff7b93', 7, 3);
  } else {
    px(ctx, cx - 4, ey + 12, INK, 9, 2);
    px(ctx, cx + 5, ey + 10, INK, 2, 3);
    px(ctx, cx - 5, ey + 11, INK, 2, 2);
    px(ctx, cx - 2, ey + 14, INK, 6, 1);
    px(ctx, cx - 2, ey + 12, '#ffffff', 5, 1);
  }

  // Crown: three points with jewels. Ink silhouette first, then the gold inside it.
  const cy = top - 8;
  const points: [number, number][] = [[cx - 9, 6], [cx, 8], [cx + 9, 6]];
  for (const [x0, tall] of points)
    for (let k = 0; k < tall; k++) {
      const half = Math.floor((k * 4) / tall);
      px(ctx, x0 - half - 2, cy + 8 - tall + k, INK, half * 2 + 4, 1);
    }
  px(ctx, cx - 14, cy + 8, INK, 28, 8);
  for (const [x0, tall] of points)
    for (let k = 2; k < tall; k++) {
      const half = Math.floor(((k - 2) * 4) / tall);
      px(ctx, x0 - half - 1, cy + 8 - tall + k, k === 2 ? '#fff3a8' : GOLD, half * 2 + 2, 1);
    }
  px(ctx, cx - 12, cy + 8, GOLD, 24, 4);
  px(ctx, cx - 12, cy + 8, '#fff3a8', 24, 1);
  px(ctx, cx - 12, cy + 12, '#e09a26', 24, 2);
  for (const x of [cx - 8, cx, cx + 8]) {
    px(ctx, x - 2, cy + 9, INK, 4, 4);
    px(ctx, x - 1, cy + 10, x === cx ? '#ee4b5a' : '#36d6c8', 2, 2);
  }
};

const star = (ctx: Ctx, x: number, y: number) => {
  for (const [dx, dy] of [[0, -2], [2, 0], [-2, 0], [0, 2]] as const) px(ctx, x + dx, y + dy, GOLD, 2, 2);
  px(ctx, x, y, '#ffffff', 2, 2);
};

const foe = (ctx: Ctx, x: number, footY: number, ramp: Ramp, frame: FrameName, face: Face) =>
  drawSlime(ctx, x, footY, ramp, { frame, lookX: 1, lookY: 0, blink: false, crown: false, face });

// ---- the icon ----
// 64 x 64 art pixels at 8x: a slime smashing out through the screen at you. The
// picture is the screen; in its middle is a jagged hole with cracks running to the
// edges and shards of glass flying off, and the slime, tilted mid-leap and bigger
// than the hole, is coming through it. Reddit crops icons to a circle; everything
// that matters sits inside that.
const icon = (id: string, scale: number) => {
  const S = 64;
  const ctx = artboard(id, S, S, scale);
  const mx = 32;
  const my = 34;
  const TEETH = 9;
  /** How far the hole's jagged edge is from the middle, in each direction. */
  const holeEdge = (angle: number) => {
    const t = (((angle / (Math.PI * 2)) * TEETH) % 1 + 1) % 1;
    return 19 + Math.abs(t - 0.5) * 2 * 9;
  };
  sunburst(ctx, S, S, mx, my, 40);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - mx;
      const dy = y + 0.5 - my;
      const d = Math.sqrt(dx * dx + dy * dy) - holeEdge(Math.atan2(dy, dx));
      if (d < -1.5) px(ctx, x, y, '#120a22'); // the dark behind the screen
      else if (d < 0) px(ctx, x, y, '#eafaff'); // the broken edge of the glass
      else if (d < 1.2) px(ctx, x, y, INK);
    }
  // Cracks from each point of the hole out to the edge of the picture.
  for (let k = 0; k < TEETH; k++) {
    const angle = ((k + 0.5) / TEETH) * Math.PI * 2;
    const bend = k % 2 ? 0.16 : -0.14;
    for (let r = 28; r < 48; r++) {
      const wob = angle + (r > 36 ? bend : 0) * ((r - 36) / 12);
      const x = mx + Math.cos(wob) * r;
      const y = my + Math.sin(wob) * r;
      px(ctx, x + 1, y + 1, INK);
      px(ctx, x, y, '#eafaff');
    }
  }
  // Shards of glass thrown outward.
  const shard = (x: number, y: number, flip: boolean) => {
    for (let k = 0; k < 4; k++) px(ctx, flip ? x + 3 - k : x, y + k, INK, k + 2, 1);
    for (let k = 1; k < 4; k++) px(ctx, flip ? x + 4 - k : x + 1, y + k, k === 1 ? '#ffffff' : '#9fd8f5', k, 1);
  };
  shard(6, 12, false);
  shard(53, 9, true);
  shard(3, 44, true);
  shard(56, 46, false);
  shard(12, 56, false);
  shard(47, 57, true);

  // The slime on its own layer, tipped over as it leaps, then stamped on top.
  const layer = document.createElement('canvas');
  layer.width = S;
  layer.height = S;
  const lctx = layer.getContext('2d');
  if (!lctx) return;
  king(lctx, 32, 14, true);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(mx, my);
  ctx.rotate(-0.21);
  ctx.drawImage(layer, -32, -36);
  ctx.restore();
  // Speed lines behind it.
  for (const [x, y] of [[44, 52], [48, 49], [40, 55]] as const) px(ctx, x, y, '#fff3e3', 5, 1);
};

// ---- the banner ----
// 320 x 64 art pixels at 6x = 1920 x 384: a chain of floating islands, the big
// slime on the first one, the name, and foes on the others or on their way off.
const LETTERS: Record<string, string[]> = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};

/** The name in chunky gold letters: each letter pixel is 3 x 3, inked and shaded. */
const wordmark = (ctx: Ctx, text: string, x0: number, y0: number) => {
  const cells: [number, number, boolean, boolean][] = [];
  [...text].forEach((ch, i) => {
    const rows = LETTERS[ch];
    if (!rows) return;
    rows.forEach((row, r) =>
      [...row].forEach((on, c) => {
        if (on === '1') cells.push([x0 + i * 18 + c * 3, y0 + r * 3, rows[r - 1]?.[c] !== '1', rows[r + 1]?.[c] !== '1']);
      })
    );
  });
  for (const [x, y] of cells) px(ctx, x - 1, y - 1, INK, 5, 8); // outline and drop shadow
  for (const [x, y] of cells) px(ctx, x, y + 3, '#d4902a', 3, 2);
  for (const [x, y, topEdge, bottomEdge] of cells) {
    px(ctx, x, y, GOLD, 3, 3);
    if (topEdge) px(ctx, x, y, '#fff3a8', 3, 1);
    if (bottomEdge) px(ctx, x, y + 2, '#e09a26', 3, 1);
  }
};

/** A small floating island, cols x rows cells of lawn, drawn by the game's own island renderer. */
const islet = (ctx: Ctx, x: number, y: number, cols: number, rows: number, ice = false) => {
  const shape = Array.from({ length: 22 }, (_, r) =>
    r >= 2 && r < 2 + rows ? '..' + '#'.repeat(cols) + '.'.repeat(20 - cols) : '.'.repeat(22)
  );
  const img = makeIsland(shape, ice);
  ctx.drawImage(img, 14, 14, cols * 8 + 4, rows * 8 + 44, x - 2, y - 2, cols * 8 + 4, rows * 8 + 44);
};

const banner = (id: string, scale: number) => {
  const W = 320;
  const H = 64;
  const ctx = artboard(id, W, H, scale);
  sunburst(ctx, W, H, 50, 40, 44);

  // The low sun, a few clouds, and the cloud bank behind the islands.
  for (let y = -20; y <= 20; y++)
    for (let x = -20; x <= 20; x++) {
      const d = Math.sqrt(x * x + y * y);
      const color = d <= 11 ? '#fff6d2' : d <= 14 ? '#ffe6a3' : d <= 19 && (x + y) % 2 === 0 ? '#fdc184' : null;
      if (color) px(ctx, 292 + x, 22 + y, color);
    }
  const clouds = cloudSprites();
  ctx.drawImage(clouds[2]!, 4, 4);
  ctx.drawImage(clouds[1]!, 250, 2);
  const mid = makeBank(256, 60, 22, CLOUD_MID);
  for (let x = -30; x < W; x += 256) ctx.drawImage(mid, x, 46);

  // Five islands at different heights: grass, then one frozen, to show the game's range.
  islet(ctx, 14, 32, 10, 3);
  islet(ctx, 112, 40, 5, 2);
  islet(ctx, 166, 33, 4, 2);
  islet(ctx, 214, 39, 6, 2, true);
  islet(ctx, 278, 44, 4, 2);

  wordmark(ctx, 'PUSHOVER', 100, 4);
  king(ctx, 52, 9);

  // Foes: one just hit and flying to the next island, the rest standing or falling.
  star(ctx, 84, 37);
  for (const [x, y, len] of [[90, 40, 5], [100, 36, 3], [200, 50, 3], [262, 52, 3]] as const) px(ctx, x, y, '#fff3e3', len, 1);
  foe(ctx, 104, 46, FOES[0]!, 'squash', 'scared');
  drawSlime(ctx, 136, 51, FOES[1]!, { frame: 'idle', lookX: -1, lookY: 0, blink: false, crown: false });
  drawSlime(ctx, 182, 44, FOES[3]!, { frame: 'idle', lookX: -1, lookY: 0, blink: false, crown: false });
  foe(ctx, 206, 60, FOES[5]!, 'tall', 'scared');
  drawSlime(ctx, 232, 50, FOES[2]!, { frame: 'idle', lookX: -1, lookY: 0, blink: false, crown: false });
  drawSlime(ctx, 252, 51, FOES[4]!, { frame: 'low', lookX: -1, lookY: 0, blink: false, crown: false });
  drawSlime(ctx, 294, 55, FOES[0]!, { frame: 'idle', lookX: -1, lookY: 0, blink: true, crown: false });

  // The front cloud bank, over the islands' undersides.
  const front = makeBank(256, 60, 33, CLOUD_FRONT);
  for (let x = -90; x < W; x += 256) ctx.drawImage(front, x, 57);
};

const start = () => {
  document.body.style.margin = '0';
  document.body.style.background = '#1d1236';
  icon('icon', 8); // 512 x 512
  banner('banner', 6); // 1920 x 384
  document.body.dataset.ready = '1';
};
start();
