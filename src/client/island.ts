import { BOARD_H, BOARD_W, groundMask } from '../shared/sim';
import { drawRows, spriteSize } from './sprites';

/*
 * Draws one island: the top (exactly the physics mask) and the rock hanging under it.
 *
 * The rock is one solid mass, not a strip under each edge. Every point of the
 * island hangs down further the deeper inside the island it is, and what you see
 * below the top is that mass viewed from the south: thin turf at the rims, a deep
 * keel under the middle, and the far rim's rock showing through any hole.
 *
 * Top and underside never share colours: the top is bright, the face below its lip
 * is dark turf (or icicles), then soil, then stone, so the two can't be confused.
 *
 * Two looks: a grassy island, and a frozen one for ice days.
 */

/** Canvas rows below the board that the rock may use. */
export const UNDER = 46;

const HANG_BASE = 7;
const HANG_SLOPE = 1.55;

type Theme = {
  /** Outline of the top. */
  edge: string;
  /** The darker band just inside the outline. */
  lo: string;
  /** Marks a touch darker than the surface. */
  blade: string;
  base: string;
  /** Marks a touch lighter than the surface. */
  glow: string;
  /** The lip along the near edge, where the top ends. */
  light: string;
  /** What hangs over the edge (turf or icicles), and its tips. */
  face: string;
  tip: string;
  /** How far it hangs, column by column (repeats). */
  overhang: number[];
  /** Stone, darkest to lightest. */
  rock: string[];
  /** Small things scattered on top, with how likely each is (the rest stays bare). */
  scatter: { rows: string[]; chance: number }[];
  /** Blades poking over the far edge, if any. */
  edgeTuft: string[] | null;
  /** Things trailing down the rock face, if any. */
  vines: string[][];
  decor: Record<string, string>;
};

const TUFTS = [
  ['..h..', 'h.h.h', '.hlh.', '.ddd.'],
  ['h..h', '.hh.', '.dd.'],
  ['.h.', 'hlh', 'ddd'],
];

const GRASS: Theme = {
  edge: '#1f4a2e',
  lo: '#46993f',
  blade: '#4fab43',
  base: '#5cb848',
  glow: '#74d255',
  light: '#8ee060',
  face: '#2f7838',
  tip: '#1f4a2e',
  overhang: [2, 3, 4, 4, 3, 2, 2, 3, 3, 2, 1, 2, 3, 4, 3, 2],
  // Warm browns that drift to purple in the dark.
  rock: ['#2e1a2e', '#55313f', '#7d4a44', '#a8694f', '#cf8f5f'],
  scatter: [
    { rows: TUFTS[0]!, chance: 0.12 },
    { rows: TUFTS[1]!, chance: 0.11 },
    { rows: TUFTS[2]!, chance: 0.11 },
    { rows: ['.w.', 'wyw', '.w.', '.d.'], chance: 0.1 }, // daisy
    { rows: ['.p.', 'pyp', '.p.', '.d.'], chance: 0.08 }, // blossom
    { rows: ['.ss.', 'sssS', '.SS.'], chance: 0.05 }, // pebble
  ],
  edgeTuft: ['.e.e.', 'ehehe'],
  vines: [
    ['.v.', '.v.', 'v..', 'v..', '.v.', '.vl', '.v.', 'v..', 'vl.', '.V.'],
    ['v.', 'v.', '.v', '.v', 'v.', 'V.'],
    ['.v', '.v', 'v.', 'vl', '.v', '.v', '.V'],
  ],
  decor: {
    e: '#1f4a2e',
    d: '#46993f',
    l: '#74d255',
    h: '#c0f284',
    w: '#ffffff',
    y: '#ffd23f',
    p: '#ffa9d6',
    s: '#ddd6c8',
    S: '#a79e90',
    v: '#3a8a3c',
    V: '#2a6a35',
    r: '#55313f',
  },
};

const ICE: Theme = {
  edge: '#2b4a7a',
  lo: '#b4d8ee',
  blade: '#cfe8f6',
  base: '#e8f6fd',
  glow: '#ffffff',
  light: '#ffffff',
  face: '#8fc1e3',
  tip: '#eaf7fe',
  // Icicles: longer and pointier than turf.
  overhang: [2, 4, 6, 3, 2, 5, 7, 4, 2, 3, 5, 3, 2, 6, 4, 2],
  // Cold stone.
  rock: ['#241a33', '#473554', '#6b5068', '#8f7186', '#b89aa6'],
  scatter: [
    { rows: ['..www..', '.wwwww.', 'sssssss'], chance: 0.14 }, // snow mound
    { rows: ['c.....', '.cc...', '...c..', '....cc'], chance: 0.1 }, // crack
    { rows: ['.pppppp.', 'ppwwpppp', 'pppppppp', '.pppppp.'], chance: 0.08 }, // frozen puddle
    { rows: ['.c.', 'cwc', '.c.'], chance: 0.14 }, // sparkle
  ],
  edgeTuft: null,
  vines: [],
  decor: { w: '#ffffff', s: '#b4d8ee', c: '#9cc9e6', p: '#a8d8f0', r: '#473554' },
};

// Thickness of the soil under the turf.
const SOIL = [3, 3, 2, 2, 3, 4, 3, 3, 2, 3, 3, 2, 2, 3, 4, 3];
// The ragged bottom: small teeth and a few longer spikes.
const JAG = [0, 1, 2, 4, 2, 1, 0, 0, 1, 3, 6, 3, 1, 0, 1, 2, 1, 0, 0, 2, 5, 8, 5, 2, 0, 1, 1, 0, 3, 4, 2, 0];
const ROOT = ['.r.', '.r.', 'r..', 'r..', '.r.', '..r'];

// Marks on a 32x32 patch of the top, placed by hand so they don't line up.
// v: dark "v"   c: light caret   t: dark tick   u: light dash
const BLADES: [number, number, 'v' | 'c' | 't' | 'u'][] = [
  [2, 3, 'v'], [19, 1, 'v'], [10, 9, 'v'], [27, 8, 'v'], [5, 17, 'v'], [22, 15, 'v'], [14, 22, 'v'], [30, 23, 'v'], [8, 28, 'v'], [24, 29, 'v'],
  [11, 2, 'c'], [26, 3, 'c'], [4, 10, 'c'], [18, 11, 'c'], [30, 14, 'c'], [12, 16, 'c'], [1, 23, 'c'], [20, 21, 'c'], [16, 28, 'c'], [28, 18, 'c'],
  [7, 6, 't'], [23, 6, 't'], [15, 13, 't'], [2, 20, 't'], [26, 25, 't'], [11, 25, 't'],
  [15, 5, 'u'], [8, 14, 'u'], [21, 26, 'u'], [4, 30, 'u'],
];
const BLADE_SHAPES: Record<string, [number, number][]> = {
  v: [[0, 0], [2, 0], [1, 1]],
  c: [[1, 0], [0, 1], [2, 1]],
  t: [[0, 0], [1, 1]],
  u: [[0, 0], [1, 0]],
};

const hash = (x: number, y: number, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

type Ctx = CanvasRenderingContext2D;
const px = (ctx: Ctx, x: number, y: number, color: string) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
};

export const makeIsland = (shape: string[], ice = false): HTMLCanvasElement => {
  const theme = ice ? ICE : GRASS;
  const ROCK = theme.rock;
  const W = BOARD_W;
  const TOP = BOARD_H;
  const H = TOP + UNDER;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');

  const mask = groundMask(shape);
  const g = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < TOP && mask[y * W + x] === 1;

  // --- how far each top pixel is from the island's edge (two-pass chamfer).
  const dist = new Float32Array(W * TOP);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 1e6 : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= TOP ? 0 : dist[y * W + x]!);
  for (let y = 0; y < TOP; y++)
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      dist[y * W + x] = Math.min(at(x, y), at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  for (let y = TOP - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      if (!mask[y * W + x]) continue;
      dist[y * W + x] = Math.min(at(x, y), at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }

  // --- the rock: for each column, how far down the mass behind each near edge reaches.
  const depth = new Int16Array(W * H); // rows below the edge above (0 = no rock)
  const total = new Int16Array(W * H); // full height of that stretch of rock
  const edges: { x: number; y: number; total: number }[] = [];
  for (let x = 0; x < W; x++) {
    let reach = -1;
    let last = -1;
    let end = -1;
    for (let y = 0; y < H; y++) {
      if (g(x, y)) {
        reach = Math.max(reach, y + HANG_BASE + HANG_SLOPE * dist[y * W + x]!);
        last = y;
        end = -1;
        continue;
      }
      if (last < 0) continue;
      if (end < 0) {
        const tall = reach - last;
        end = Math.min(H - 2, Math.round(reach + JAG[(x + 5) % JAG.length]! * Math.min(1, tall / 20)));
        // If the top starts again further down this column, this is a hole or a bite:
        // let the far rim's rock fill only the top of it, so sky always shows below.
        let next = -1;
        for (let yy = y; yy < TOP && next < 0; yy++) if (g(x, yy)) next = yy;
        if (next >= 0) end = Math.min(end, y + Math.max(2, Math.floor((next - y) * 0.45)) - 1);
        if (end > last) edges.push({ x, y: last, total: end - last });
      }
      if (y <= end) {
        depth[y * W + x] = y - last;
        total[y * W + x] = end - last;
      }
    }
  }
  const rock = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && depth[y * W + x]! > 0;
  const air = (x: number, y: number) => !rock(x, y) && !g(x, y);
  const turf = (x: number, t: number) => Math.min(t, theme.overhang[(x + 3) % theme.overhang.length]!);
  const soil = (x: number) => SOIL[(x + 7) % SOIL.length]!;

  // --- stones: irregular flat cells, each lit on its top-left and dark on its bottom-right.
  const SX = 10;
  const SY = 7;
  const stoneAt = (x: number, y: number): number => {
    const gx0 = Math.floor(x / SX);
    const gy0 = Math.floor(y / SY);
    let best = 0;
    let bestD = Infinity;
    for (let gy = gy0 - 1; gy <= gy0 + 1; gy++)
      for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        const sx = gx * SX + (gy & 1) * (SX / 2) + 2 + hash(gx, gy, 71) * (SX - 4);
        const sy = gy * SY + 1 + hash(gx, gy, 72) * (SY - 2);
        const d = ((x - sx) / 1.3) ** 2 + (y - sy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = gx * 4099 + gy * 131 + 7;
        }
      }
    return best;
  };
  const stone = new Int32Array(W * H).fill(-1);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = depth[y * W + x]!;
      if (k > 0 && k > turf(x, total[y * W + x]!) + soil(x)) stone[y * W + x] = stoneAt(x, y);
    }
  const stoneId = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : stone[y * W + x]!);

  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = depth[y * W + x]!;
      if (!k) continue;
      const t = total[y * W + x]!;
      const over = turf(x, t);
      const exposed = air(x - 1, y) || air(x + 1, y) || air(x, y + 1);
      if (k <= over) {
        // Turf (or ice) hanging over the edge, with its own tips.
        px(ctx, x, y, k === over ? theme.tip : exposed ? theme.edge : theme.face);
        continue;
      }
      if (exposed) {
        px(ctx, x, y, ROCK[0]!);
        continue;
      }
      if (k <= over + soil(x)) {
        px(ctx, x, y, k === over + 1 ? ROCK[0]! : hash(x, y, 61) < 0.16 ? ROCK[2]! : ROCK[1]!);
        continue;
      }
      const id = stoneId(x, y);
      const crack = (stoneId(x + 1, y) !== id && rock(x + 1, y)) || (stoneId(x, y + 1) !== id && rock(x, y + 1));
      const lit = stoneId(x - 1, y) !== id || stoneId(x, y - 1) !== id;
      const body = hash(id, 1, 81) < 0.35 ? 2 : 3;
      let tone = crack ? 1 : lit ? body + 1 : body;
      // Darker toward the bottom, lit along the left flank, shaded on the right.
      const f = (k - over - soil(x)) / Math.max(1, t - over - soil(x));
      if (f > 0.7) tone -= 2;
      else if (f > 0.38) tone -= 1;
      if (air(x - 2, y)) tone += 1;
      if (air(x + 2, y) || air(x + 3, y) || air(x, y + 2)) tone -= 1;
      px(ctx, x, y, ROCK[Math.max(0, Math.min(4, tone))]!);
    }

  // Vines trailing from the turf, and roots under the deepest rock.
  let lastVine = -99;
  for (const e of edges) {
    if (theme.vines.length && e.total >= 10 && e.x - lastVine > 9 && hash(e.x, e.y, 91) < 0.1) {
      lastVine = e.x;
      const vine = theme.vines[Math.floor(hash(e.x, e.y, 92) * theme.vines.length)]!;
      drawRows(ctx, vine, e.x - 1, e.y + turf(e.x, e.total), theme.decor);
    }
    if (e.total >= 16 && hash(e.x, e.y, 93) < 0.05) drawRows(ctx, ROOT, e.x - 1, e.y + e.total + 1, theme.decor);
  }

  // --- the top.
  ctx.fillStyle = theme.base;
  for (let y = 0; y < TOP; y++) for (let x = 0; x < W; x++) if (g(x, y)) ctx.fillRect(x, y, 1, 1);
  const inside = (x: number, y: number, room: number) => g(x, y) && dist[y * W + x]! >= room;
  for (let ty = 0; ty < TOP; ty += 32)
    for (let tx = 0; tx < W; tx += 32)
      for (const [bx, by, kind] of BLADES) {
        const color = kind === 'v' || kind === 't' ? theme.blade : theme.glow;
        if (!inside(tx + bx + 1, ty + by, 4)) continue;
        for (const [dx, dy] of BLADE_SHAPES[kind]!) px(ctx, tx + bx + dx, ty + by + dy, color);
      }
  // Small things on a loose grid, kept well inside the edge.
  for (let gy = 0; gy < TOP; gy += 13)
    for (let gx = 0; gx < W; gx += 13) {
      const x = gx + 3 + Math.floor(hash(gx, gy, 41) * 8);
      const y = gy + 3 + Math.floor(hash(gx, gy, 42) * 8);
      if (!inside(x, y, 7)) continue;
      let roll = hash(gx, gy, 43);
      const pick = theme.scatter.find((s) => (roll -= s.chance) < 0);
      if (!pick) continue;
      const [w, h] = spriteSize(pick.rows);
      drawRows(ctx, pick.rows, x - Math.floor(w / 2), y - Math.floor(h / 2), theme.decor);
    }

  // --- the border: a dark outline on the far and side edges with a darker band
  // inside it, and a bright lip along the near edge where the top ends.
  for (let y = 0; y < TOP; y++)
    for (let x = 0; x < W; x++) {
      if (!g(x, y)) continue;
      const far = !g(x, y - 1) || !g(x - 1, y) || !g(x + 1, y);
      const near = !g(x, y + 1);
      if (far) px(ctx, x, y, theme.edge);
      else if (near) px(ctx, x, y, theme.light);
      else if (!g(x, y + 2)) px(ctx, x, y, theme.glow);
      else if (!g(x, y - 2) || !g(x - 2, y) || !g(x + 2, y) || !g(x - 1, y - 1) || !g(x + 1, y - 1)) px(ctx, x, y, theme.lo);
    }
  // Blades poking over flat stretches of the far edge.
  if (theme.edgeTuft) {
    let lastTuft = -99;
    for (let y = 1; y < TOP; y++)
      for (let x = 3; x < W - 3; x++) {
        let flat = true;
        for (let i = -3; i <= 3 && flat; i++) flat = g(x + i, y) && !g(x + i, y - 1);
        if (!flat || Math.abs(x - lastTuft) < 9 || hash(x, y, 97) > 0.2) continue;
        lastTuft = x;
        drawRows(ctx, theme.edgeTuft, x - 2, y - 1, theme.decor);
      }
  }
  return canvas;
};
