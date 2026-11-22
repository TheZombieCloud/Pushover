import { randomShape, rng } from '../shared/gen';
import { CELL, COLS, FOE_KINDS, ROWS } from '../shared/sim';
import type { FoeKind, Level, Rock, Spot } from '../shared/sim';
import { canStand, clearOf } from '../shared/validate';

export type DraftFoe = Spot & { kind: FoeKind };

/** An island being made in the editor. */
export type Draft = {
  shape: string[];
  you: Spot;
  foes: DraftFoe[];
  rocks: Rock[];
  ice: boolean;
  turns: number;
};

const far = (a: Spot, b: Spot) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** A fresh island to start from: a random outline with you and a few foes on it. */
export const starter = (seed: number, foes = 3, keep?: Pick<Draft, 'ice' | 'turns'>): Draft => {
  const shape = randomShape(seed);
  const r = rng(seed + 7919);
  const cells: Spot[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let col = 0; col < COLS; col++) if (shape[row]?.[col] === '#') cells.push({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });
  const placed: Spot[] = [];
  for (let tries = 0; tries < 600 && placed.length < foes + 1; tries++) {
    const spot = cells[Math.floor(r() * cells.length)];
    if (!spot || !canStand(shape, spot) || !clearOf(spot, placed, [])) continue;
    // Spread out a little more than the rules demand.
    if (placed.some((p) => far(p, spot) < 26)) continue;
    placed.push(spot);
  }
  const you = placed[0] ?? { x: (COLS * CELL) / 2, y: (ROWS * CELL) / 2 };
  // One of each kind in turn, so a new maker meets them all.
  const cast = placed.slice(1).map((s, i) => ({ ...s, kind: FOE_KINDS[i % FOE_KINDS.length]! }));
  return { shape, you, foes: cast, rocks: [], ice: keep?.ice ?? false, turns: keep?.turns ?? 3 };
};

/** The draft as a playable level. */
export const draftLevel = (d: Draft, par = 0): Level => ({
  shape: d.shape,
  you: d.you,
  foes: d.foes,
  turns: d.turns,
  par,
  ...(d.rocks.length ? { rocks: d.rocks } : {}),
  ...(d.ice ? { ice: true } : {}),
});
