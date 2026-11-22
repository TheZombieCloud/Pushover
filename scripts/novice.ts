// How does the pool treat someone who has never played? Run with:
//   node --experimental-strip-types scripts/novice.ts        (HEED=1 to heed the fall warning)
//
// A "novice" aims at the nearest foe where it stands now (not where it is going),
// a few notches off, at a random strength from 3 up. For each weekday this prints
// how first runs go and how many runs it takes such a player to clear the island.
// It is a yardstick for tuning, not a model of anyone in particular.
import { readFileSync } from 'node:fs';
import { MAX_POWER, cloneState, createState, landing, outs, playTurn, youFell } from '../src/shared/sim.ts';
import type { Level } from '../src/shared/sim.ts';
import { rng } from '../src/shared/gen.ts';

const pool: Level[][] = JSON.parse(readFileSync(new URL('../src/shared/levels.json', import.meta.url), 'utf8'));
const HEED = process.env.HEED === '1';
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const UNIT = Array.from({ length: 72 }, (_, d) => {
  const to = landing({ x: 0, y: 0 }, { d, p: 1 });
  const len = Math.hypot(to.x, to.y);
  return [to.x / len, to.y / len] as const;
});
const dirFor = (dx: number, dy: number) => {
  let best = 0;
  let most = -Infinity;
  UNIT.forEach(([ux, uy], d) => {
    const dot = ux * dx + uy * dy;
    if (dot > most) {
      most = dot;
      best = d;
    }
  });
  return best;
};

const run = (level: Level, r: () => number) => {
  const state = createState(level);
  for (let t = 0; t < level.turns; t++) {
    const me = state.bodies[0]!;
    let near = -1;
    let nearD = Infinity;
    state.bodies.forEach((b, i) => {
      if (i === 0 || !b.alive) return;
      const d = Math.hypot(b.x - me.x, b.y - me.y);
      if (d < nearD) {
        nearD = d;
        near = i;
      }
    });
    if (near < 0) break;
    const foe = state.bodies[near]!;
    const at = dirFor(foe.x - me.x, foe.y - me.y);
    let d = 0;
    let p = 0;
    // With HEED=1 the player heeds the red arrow: re-aims (up to 6 times) while the
    // push as aimed would take them off the island.
    for (let go = 0; go < (HEED ? 6 : 1); go++) {
      d = (at + Math.floor(r() * 5) - 2 + 72) % 72;
      p = 3 + Math.floor(r() * (MAX_POWER - 2));
      if (!HEED) break;
      const trial = cloneState(state);
      playTurn(trial, level, t, { d, p });
      if (!youFell(trial)) break;
    }
    playTurn(state, level, t, { d, p });
    // Falling ends the run; you keep the foes already pushed off.
    if (youFell(state)) break;
  }
  const score = outs(state);
  return { score, fell: youFell(state), clear: score === level.foes.length };
};

console.log('day  first run: fell  scored 0  scored 1+  cleared | mean share pushed | runs to clear (median, mean, never in 40)');
pool.forEach((tier, ti) => {
  const r = rng(1234 + ti);
  let fell = 0;
  let none = 0;
  let share = 0;
  let swept = 0;
  const tries: number[] = [];
  let never = 0;
  const levels = tier.slice(0, 26);
  for (const level of levels) {
    for (let player = 0; player < 20; player++) {
      const first = run(level, r);
      if (first.fell) fell++;
      if (first.score === 0) none++;
      share += first.score / level.foes.length;
      if (first.clear) swept++;
      let n = 1;
      let res = first;
      while (!res.clear && n < 40) {
        res = run(level, r);
        n++;
      }
      if (res.clear) tries.push(n);
      else never++;
    }
  }
  const total = levels.length * 20;
  tries.sort((a, b) => a - b);
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`.padStart(4);
  const mean = tries.length ? (tries.reduce((a, b) => a + b, 0) / tries.length).toFixed(1) : '-';
  console.log(
    `${DAYS[ti]}             ${pct(fell)}     ${pct(none)}    ${pct(total - none)}    ${pct(swept)} |        ${(share / total).toFixed(2)}       | ${tries[Math.floor(tries.length / 2)] ?? '-'}, ${mean}, ${pct(never)}`
  );
});
