import { cloneState, isMoving, launch, step } from '../shared/sim';
import type { Level, Move, Spot, State } from '../shared/sim';

/*
 * Aiming aids, tried out as prototypes (switched on with ?guide= in the address).
 * Both run the real simulation on a copy of the board, so what they show is exact.
 */

export type Ghost = { x: number; y: number; alive: boolean };

/** Where everyone ends up if these moves are played: the whole turn, collisions and all. */
export const outcome = (level: Level, state: State, moves: Move[]): Ghost[] => {
  const s = cloneState(state);
  launch(s, moves);
  while (isMoving(s)) step(s, level);
  return s.bodies.map((b) => ({ x: b.x, y: b.y, alive: b.alive }));
};

export type Bounce = {
  /** Your path up to the first slime you hit (with a corner at each boulder). */
  path: Spot[];
  /** The slime you hit and where that knock sends it, if nothing else interferes. */
  hit: { who: number; to: Spot };
};

/**
 * The pool-table guide: only your slime moves. If it hits another slime, returns your
 * path to that contact and where the struck slime ends up. Null if you hit nobody.
 */
export const firstBounce = (level: Level, state: State, mine: Move): Bounce | null => {
  if (mine.p <= 0) return null;
  const s = cloneState(state);
  launch(s, [mine]);
  const you = s.bodies[0];
  if (!you) return null;
  const path: Spot[] = [{ x: you.x, y: you.y }];
  let struck = -1;
  while (isMoving(s)) {
    for (const e of step(s, level)) {
      if (struck >= 0) continue;
      if (e.kind === 'bonk' && e.who === 0) path.push({ x: you.x, y: you.y });
      else if (e.kind === 'fall' && e.who === 0) return null;
      else if (e.kind === 'hit' && (e.a === 0 || e.b === 0)) {
        struck = e.a === 0 ? e.b : e.a;
        path.push({ x: you.x, y: you.y });
      }
    }
  }
  const foe = s.bodies[struck];
  return foe ? { path, hit: { who: struck, to: { x: foe.x, y: foe.y } } } : null;
};
