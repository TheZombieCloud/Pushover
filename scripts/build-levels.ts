// Builds the daily island pool: src/shared/levels.json.
//
//   npm run levels
//
// Seven tiers, one per weekday (Monday easiest, Sunday hardest), 52 islands each.
// Three days have a twist: Wednesday has boulders, Friday is frozen, Sunday is both.
// Each candidate is generated from a seed and solved by beam search. It is kept only
// if every foe can be pushed off with turns to spare: the solver has to clear the
// island in `spare` fewer turns than the player gets, so there is room for a wasted
// push or a plan that is not the best one. The weekend is stricter: no turn to
// spare on Sunday, and on both days the island must not fall to a habit (take the
// best push right now, ram the nearest foe, never move), so it needs a plan.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirFor } from '../src/shared/dirs.ts';
import { generate } from '../src/shared/gen.ts';
import { solve } from '../src/shared/solve.ts';
import { AIM_MOVES, STAY, cloneState, createState, outs, playTurn, youFell } from '../src/shared/sim.ts';
import type { Level, Move, State } from '../src/shared/sim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PER_TIER = Number(process.env.PER_TIER ?? 52);

type Tier = { day: string; foes: number; turns: number; spare: number; plan?: boolean; rocks?: [number, number]; ice?: boolean };
const TIERS: Tier[] = [
  { day: 'Mon', foes: 2, turns: 4, spare: 2 },
  { day: 'Tue', foes: 3, turns: 4, spare: 2 },
  { day: 'Wed', foes: 3, turns: 4, spare: 2, rocks: [2, 4] },
  { day: 'Thu', foes: 4, turns: 5, spare: 2 },
  { day: 'Fri', foes: 4, turns: 5, spare: 1, ice: true },
  { day: 'Sat', foes: 5, turns: 5, spare: 1 },
  { day: 'Sun', foes: 5, turns: 5, spare: 1, plan: true, rocks: [2, 3], ice: true },
];

/** A way of playing that needs no thought: one rule, applied every turn. */
type Habit = (level: Level, state: State, turn: number) => Move;

const playHabit = (level: Level, habit: Habit): number => {
  const state = createState(level);
  for (let t = 0; t < level.turns; t++) {
    playTurn(state, level, t, habit(level, state, t));
    if (youFell(state)) return 0;
    if (outs(state) === level.foes.length) break;
  }
  return outs(state);
};

/** Take whichever push knocks the most off right away. */
const greedy: Habit = (level, state, turn) => {
  let best: Move = STAY;
  let most = -1;
  for (const m of AIM_MOVES) {
    const s = cloneState(state);
    playTurn(s, level, turn, m);
    if (!youFell(s) && outs(s) > most) {
      most = outs(s);
      best = m;
    }
  }
  return best;
};

/** Ram whoever is nearest, at a fixed strength. */
const ram =
  (p: number): Habit =>
  (_level, state) => {
    const me = state.bodies[0]!;
    let near: State['bodies'][number] | null = null;
    for (const b of state.bodies.slice(1)) {
      if (!b.alive) continue;
      if (!near || (b.x - me.x) ** 2 + (b.y - me.y) ** 2 < (near.x - me.x) ** 2 + (near.y - me.y) ** 2) near = b;
    }
    return near ? { d: dirFor(near.x - me.x, near.y - me.y), p } : STAY;
  };

const HABITS: Habit[] = [greedy, ram(6), ram(4), ram(2), () => STAY];

export type PoolLevel = Level & { id: string; tier: number; rate: number; solution: Move[] };

const pool: PoolLevel[][] = [];
let seed = 1000;
const started = Date.now();
for (const [ti, tier] of TIERS.entries()) {
  const kept: PoolLevel[] = [];
  let tried = 0;
  while (kept.length < PER_TIER) {
    seed++;
    tried++;
    const raw = generate(seed, { foes: tier.foes, turns: tier.turns, ...(tier.rocks ? { rocks: tier.rocks } : {}), ...(tier.ice ? { ice: true } : {}) });
    if (!raw) continue;
    // Solve it in fewer turns than the player will get.
    const best = solve({ ...raw, turns: tier.turns - tier.spare }, 24);
    if (best.score < tier.foes) continue;
    // One push that clears everything is no puzzle, even on a Monday.
    if (best.moves.length < 2) continue;
    if (tier.plan && (solve(raw, 1).score >= tier.foes || HABITS.some((h) => playHabit(raw, h) >= tier.foes))) continue;
    const level: Level = { ...raw, par: best.score };
    const rate = 0;
    kept.push({ id: `${tier.day.toLowerCase()}-${seed}`, tier: ti, rate, ...level, solution: best.moves });
  }
  pool.push(kept);
  console.log(`${tier.day}: ${kept.length} kept of ${tried} tried (${Math.round((Date.now() - started) / 1000)}s)`);
}

writeFileSync(join(root, 'src/shared/levels.json'), JSON.stringify(pool));
console.log('wrote src/shared/levels.json');
