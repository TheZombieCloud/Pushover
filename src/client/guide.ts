import { DIRS } from '../shared/dirs';
import { MAX_POWER, cloneState, createState, isMoving, launch, outs, playTurn, step, youFell } from '../shared/sim';
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

/**
 * The push shown to teach the game (on the feed card, and by the hand the first time
 * someone plays): a first-turn push that sends one foe off and keeps you on, the
 * gentlest such. One and no more, so it gives little of the island away; if every
 * scoring push sends several off, the one that sends the fewest. Null if no single
 * push sends anyone off.
 */
export const showPush = (level: Level): Move | null => {
  let best: Move | null = null;
  let fewest = Infinity;
  for (let p = 3; p <= MAX_POWER; p++)
    for (let d = 0; d < DIRS; d += 2) {
      const trial = createState(level);
      playTurn(trial, level, 0, { d, p });
      const off = outs(trial);
      if (youFell(trial) || off === 0 || off >= fewest) continue;
      fewest = off;
      best = { d, p };
    }
  return best;
};

/** The whole turn, tick by tick: where everyone is at each moment, for a preview that moves. */
export const rehearsal = (level: Level, state: State, moves: Move[]): Ghost[][] => {
  const s = cloneState(state);
  launch(s, moves);
  const frames: Ghost[][] = [];
  const snap = () => frames.push(s.bodies.map((b) => ({ x: b.x, y: b.y, alive: b.alive })));
  snap();
  while (isMoving(s) && frames.length < 900) {
    step(s, level);
    snap();
  }
  return frames;
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
