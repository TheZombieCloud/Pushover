import { CELL, COLS, FOE_KINDS, RADIUS, ROCK_SIZES, ROWS, createState, isGround, outs, playTurn } from './sim.ts';
import type { Foe, FoeKind, Level, Rock, Spot } from './sim.ts';
import { edgeDistance } from './solve.ts';

/*
 * Random islands for the daily pool. Integer-only RNG (mulberry32), so a seed always
 * makes the same island. Shapes are unions and cuts of discs, diamonds and boxes on
 * the 22x22 grid, trimmed to one connected piece with a ring of sky around it.
 */

export type Rng = () => number;

export const rng = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const int = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

type Grid = boolean[][];
const empty = (): Grid => Array.from({ length: ROWS }, () => Array<boolean>(COLS).fill(false));
const C = (COLS - 1) / 2;

const paint = (g: Grid, on: boolean, test: (r: number, c: number) => boolean) => {
  for (let r = 1; r < ROWS - 1; r++) for (let c = 1; c < COLS - 1; c++) if (test(r, c)) g[r]![c] = on;
};
const disc = (cr: number, cc: number, rad: number) => (r: number, c: number) =>
  (r - cr) * (r - cr) + (c - cc) * (c - cc) <= rad * rad + rad * 0.6;
const diamond = (cr: number, cc: number, rad: number) => (r: number, c: number) =>
  Math.abs(r - cr) + Math.abs(c - cc) <= rad;
const box = (r0: number, c0: number, r1: number, c1: number) => (r: number, c: number) =>
  r >= r0 && r <= r1 && c >= c0 && c <= c1;

const SHAPES: ((r: Rng) => Grid)[] = [
  // Round island with a lumpy coast.
  (r) => {
    const g = empty();
    paint(g, true, disc(C, C, int(r, 7, 9)));
    for (let i = 0; i < 4; i++) paint(g, i % 2 === 0, disc(int(r, 3, 18), int(r, 3, 18), int(r, 2, 3)));
    return g;
  },
  // Two islands joined by a bridge.
  (r) => {
    const g = empty();
    const vertical = r() < 0.5;
    const a = int(r, 5, 6);
    const b = int(r, 4, 6);
    if (vertical) {
      paint(g, true, disc(6, C, a));
      paint(g, true, disc(15, C, b));
      paint(g, true, box(6, C - 1, 15, C + 1));
    } else {
      paint(g, true, disc(C, 6, a));
      paint(g, true, disc(C, 15, b));
      paint(g, true, box(C - 1, 6, C + 1, 15));
    }
    return g;
  },
  // Ring with a hole in the middle.
  (r) => {
    const g = empty();
    paint(g, true, disc(C, C, int(r, 8, 9)));
    paint(g, false, disc(C + int(r, -1, 1), C + int(r, -1, 1), int(r, 2, 4)));
    return g;
  },
  // Diamond.
  (r) => {
    const g = empty();
    paint(g, true, diamond(C, C, int(r, 9, 10)));
    if (r() < 0.6) paint(g, false, diamond(C, C, int(r, 1, 2)));
    return g;
  },
  // Plus.
  (r) => {
    const g = empty();
    const w = int(r, 3, 4);
    paint(g, true, box(C - w, 2, C + w, COLS - 3));
    paint(g, true, box(2, C - w, ROWS - 3, C + w));
    paint(g, true, disc(C, C, int(r, 4, 6)));
    return g;
  },
  // Chunky box with bites.
  (r) => {
    const g = empty();
    paint(g, true, box(int(r, 3, 5), int(r, 2, 4), int(r, 16, 18), int(r, 17, 19)));
    for (let i = 0; i < 3; i++) paint(g, false, disc(int(r, 2, 19), int(r, 2, 19), int(r, 2, 3)));
    return g;
  },
];

/** Keep the biggest connected piece (4-neighbour). */
const largest = (g: Grid): Grid => {
  const seen = empty();
  let best: [number, number][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!g[r]![c] || seen[r]![c]) continue;
      const cells: [number, number][] = [[r, c]];
      seen[r]![c] = true;
      for (let i = 0; i < cells.length; i++) {
        const [cr, cc] = cells[i]!;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (g[nr]?.[nc] && !seen[nr]![nc]) {
            seen[nr]![nc] = true;
            cells.push([nr, nc]);
          }
        }
      }
      if (cells.length > best.length) best = cells;
    }
  const out = empty();
  for (const [r, c] of best) out[r]![c] = true;
  return out;
};

export const toShape = (g: Grid): string[] => g.map((row) => row.map((v) => (v ? '#' : '.')).join(''));

/** A random island outline, the same for the same seed (the editor starts from one). */
export const randomShape = (seed: number): string[] => {
  const r = rng(seed);
  return toShape(largest(SHAPES[int(r, 0, SHAPES.length - 1)]!(r)));
};

const center = (r: number, c: number): Spot => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
const dist = (a: Spot, b: Spot) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

export type GenOptions = {
  foes: number;
  turns: number;
  /** How many boulders to place, as [fewest, most]. */
  rocks?: [number, number];
  /** A frozen island. */
  ice?: boolean;
};

/** A raw level (par 0); the pool builder solves and filters it. */
export const generate = (seed: number, opt: GenOptions): Level | null => {
  const r = rng(seed);
  const shape = toShape(largest(SHAPES[int(r, 0, SHAPES.length - 1)]!(r)));
  const edge = edgeDistance(shape);
  const cells: [number, number][] = [];
  for (let rr = 0; rr < ROWS; rr++) for (let c = 0; c < COLS; c++) if (shape[rr]![c] === '#') cells.push([rr, c]);
  if (cells.length < 90) return null;

  // You start somewhere safe-ish; foes anywhere at least 2 cells from the edge... mostly.
  const pick = (minEdge: number, taken: Spot[]): Spot | null => {
    for (let tries = 0; tries < 200; tries++) {
      const [rr, c] = cells[int(r, 0, cells.length - 1)]!;
      if ((edge[rr]![c] ?? 0) < minEdge) continue;
      const s = center(rr, c);
      // The outline is smoothed (see groundMask), so make sure the spot and a little
      // room around it really are on the grass.
      const room = minEdge >= 3 ? 8 : 4;
      const onGrass = [[0, 0], [room, 0], [-room, 0], [0, room], [0, -room]].every(([dx, dy]) => isGround(shape, s.x + dx!, s.y + dy!));
      if (onGrass && taken.every((t) => dist(t, s) >= 26)) return s;
    }
    return null;
  };
  const you = pick(3, []);
  if (!you) return null;
  const spots: Spot[] = [you];
  for (let i = 0; i < opt.foes; i++) {
    const s = pick(i < 2 ? 1 : 2, spots);
    if (!s) return null;
    spots.push(s);
  }

  // Boulders: well inside the island, clear of every slime, with room to pass between them.
  const rocks: Rock[] = [];
  if (opt.rocks) {
    const want = int(r, opt.rocks[0], opt.rocks[1]);
    for (let tries = 0; tries < 300 && rocks.length < want; tries++) {
      const [rr, c] = cells[int(r, 0, cells.length - 1)]!;
      if ((edge[rr]![c] ?? 0) < 2) continue;
      const rock: Rock = { ...center(rr, c), r: ROCK_SIZES[int(r, 0, ROCK_SIZES.length - 1)]! };
      if (spots.some((s) => dist(s, rock) < RADIUS + rock.r + 8)) continue;
      if (rocks.some((o) => dist(o, rock) < o.r + rock.r + RADIUS * 2 + 4)) continue;
      rocks.push(rock);
    }
    if (rocks.length < opt.rocks[0]) return null;
  }

  // The cast: always a chaser, a dodger once there is room for one, at most one
  // mirror, and the rest a mix. Dealt to the spots in a shuffled order.
  const kinds: FoeKind[] = opt.foes >= 2 ? ['chaser', 'dodger'] : ['chaser'];
  while (kinds.length < opt.foes) {
    const k = FOE_KINDS[int(r, 0, FOE_KINDS.length - 1)]!;
    if (k === 'mirror' && kinds.includes('mirror')) continue;
    kinds.push(k);
  }
  for (let i = kinds.length - 1; i > 0; i--) {
    const j = int(r, 0, i);
    [kinds[i], kinds[j]] = [kinds[j]!, kinds[i]!];
  }
  const foes: Foe[] = spots.slice(1).map((s, i) => {
    const kind = kinds[i]!;
    return kind === 'chaser' ? { x: s.x, y: s.y, kind, power: [3, 5][int(r, 0, 1)]! } : { x: s.x, y: s.y, kind };
  });
  const level: Level = { shape, you, foes, turns: opt.turns, par: 0, ...(rocks.length ? { rocks } : {}), ...(opt.ice ? { ice: true } : {}) };
  // Left alone, the foes should not knock each other off.
  const state = createState(level);
  for (let t = 0; t < opt.turns; t++) playTurn(state, level, t, { d: 0, p: 0 });
  if (outs(state) > 0) return null;
  return level;
};
