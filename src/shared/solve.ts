import { DIRS } from './dirs.ts';
import { CELL, COLS, MAX_POWER, ROWS, cloneState, createState, outs, playTurn, youFell } from './sim.ts';
import type { Level, Move, State } from './sim.ts';

/*
 * Finds a strong line for a level with beam search: each turn, try every move
 * (36 aims x 8 powers + stay) from each kept state, keep the most promising states,
 * repeat. Its best score becomes the level's par. Players can beat it.
 */

/** Cells from each grass cell to the nearest sky cell (0 = sky). */
export const edgeDistance = (shape: string[]): number[][] => {
  const dist = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => (shape[r]?.[c] === '#' ? Infinity : 0))
  );
  const queue: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (dist[r]![c] === 0) queue.push([r, c]);
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i]!;
    const d = dist[r]![c]!;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
        if (dist[nr]![nc]! > d + 1) {
          dist[nr]![nc] = d + 1;
          queue.push([nr, nc]);
        }
      }
  }
  return dist;
};

const edgeAt = (edge: number[][], x: number, y: number) =>
  edge[Math.floor(y / CELL)]?.[Math.floor(x / CELL)] ?? 0;

export const candidateMoves = (dirStep = 2): Move[] => {
  const moves: Move[] = [{ d: 0, p: 0 }];
  for (let d = 0; d < DIRS; d += dirStep) for (let p = 1; p <= MAX_POWER; p++) moves.push({ d, p });
  return moves;
};

type Node = { state: State; moves: Move[]; value: number };

const value = (s: State, edge: number[][]) => {
  if (youFell(s)) return -Infinity;
  let v = outs(s) * 1000;
  s.bodies.forEach((b, i) => {
    if (!b.alive) return;
    const e = Math.min(6, edgeAt(edge, b.x, b.y));
    if (i === 0) v += Math.min(e, 3) * 4; // keep yourself away from the edge
    else v += (6 - e) * 6; // foes near the edge are nearly out
  });
  return v;
};

const keyOf = (s: State) => s.bodies.map((b) => (b.alive ? `${Math.round(b.x / 3)},${Math.round(b.y / 3)}` : 'x')).join('|');

export type Solution = { score: number; moves: Move[] };

export const solve = (level: Level, beam = 16, dirStep = 2, only?: Move[]): Solution => {
  const edge = edgeDistance(level.shape);
  const cands = only ?? candidateMoves(dirStep);
  let frontier: Node[] = [{ state: createState(level), moves: [], value: 0 }];
  let best: Solution = { score: 0, moves: [] };
  for (let t = 0; t < level.turns; t++) {
    const next = new Map<string, Node>();
    for (const node of frontier) {
      for (const m of cands) {
        const s = cloneState(node.state);
        playTurn(s, level, t, m);
        if (youFell(s)) continue;
        const moves = [...node.moves, m];
        const o = outs(s);
        if (o > best.score) best = { score: o, moves };
        if (o === level.foes.length) return best;
        const v = value(s, edge);
        const k = keyOf(s);
        const prev = next.get(k);
        if (!prev || prev.value < v) next.set(k, { state: s, moves, value: v });
      }
    }
    frontier = [...next.values()].sort((a, b) => b.value - a.value).slice(0, beam);
    if (!frontier.length) break;
  }
  return best;
};
