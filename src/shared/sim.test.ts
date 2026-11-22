import { test } from 'node:test';
import assert from 'node:assert/strict';
import poolJson from './levels.json' with { type: 'json' };
import { dailyPoolLevel, type PoolLevel } from './pool.ts';
import { FOE_KINDS, createState, isGround, isValidMove, lonePath, movesAt, runLevel } from './sim.ts';

const POOL = poolJson as PoolLevel[][];

test('every pool island replays its stored solution to exactly par', () => {
  for (const tier of POOL)
    for (const l of tier) {
      const r = runLevel(l, l.solution);
      assert.equal(r.score, l.par, l.id);
      assert.equal(r.fell, false, l.id);
    }
});

test('a run replays identically', () => {
  const l = POOL[3]![7]!;
  assert.deepEqual(runLevel(l, l.solution), runLevel(structuredClone(l), structuredClone(l.solution)));
});

test('left alone, nobody leaves the island: holding still every turn scores 0', () => {
  for (const tier of POOL)
    for (const l of tier) {
      const r = runLevel(l, Array.from({ length: l.turns }, () => ({ d: 0, p: 0 })));
      assert.equal(r.outs, 0, l.id);
    }
});

test('every pool foe has a kind', () => {
  for (const tier of POOL)
    for (const l of tier) {
      assert.ok(l.foes.every((f) => FOE_KINDS.some((k) => k === f.kind)), l.id);
    }
});

// A spread of your moves, for the mirror to answer: every third aim at three strengths.
const SOME_MOVES = Array.from({ length: 24 }, (_, i) => [2, 4, 6].map((p) => ({ d: i * 3, p }))).flat();

test('a foe never takes itself off the island, whatever you do', () => {
  // Alone on the island with you, a foe that is never touched must still be there.
  for (const l of [POOL[0]![0]!, POOL[3]![5]!, POOL[6]![9]!])
    for (const foe of l.foes)
      for (const m of SOME_MOVES) {
        const far = { ...l, you: l.you, foes: [foe] };
        const state = createState(far);
        const before = { x: state.bodies[0]!.x, y: state.bodies[0]!.y };
        // You stay where you are (your body is put back each turn), so only the foe's own moves count.
        for (let t = 0; t < l.turns; t++) {
          const moves = movesAt(far, state, t, m);
          const alone = lonePath(far, state.bodies[1]!, moves[1]!);
          const end = alone[alone.length - 1]!;
          assert.ok(isGround(far.shape, end.x, end.y), `${l.id} ${foe.kind} turn ${t}`);
          state.bodies[1]!.x = end.x;
          state.bodies[1]!.y = end.y;
          state.bodies[0]!.x = before.x;
          state.bodies[0]!.y = before.y;
        }
      }
});

test('moves are validated', () => {
  assert.ok(isValidMove({ d: 71, p: 6 }));
  for (const bad of [{ d: 72, p: 1 }, { d: 0, p: 7 }, { d: 1.5, p: 1 }, { d: -1, p: 0 }, null, 'x', { d: '1', p: 1 }])
    assert.equal(isValidMove(bad), false, JSON.stringify(bad));
});

test('the daily rotates through the weekday tiers', () => {
  assert.equal(dailyPoolLevel('2026-11-16').tier, 0); // a Monday
  assert.equal(dailyPoolLevel('2026-11-22').tier, 6); // a Sunday
  assert.notEqual(dailyPoolLevel('2026-11-16').id, dailyPoolLevel('2026-11-23').id);
});

test('a slime sent at a boulder bounces back instead of passing through', async () => {
  const { lonePath } = await import('./sim.ts');
  const path = lonePath({ rocks: [{ x: 60, y: 0, r: 8 }] }, { x: 0, y: 0 }, { d: 0, p: 6 });
  assert.ok(path.length >= 3, 'the path has a corner where it bounced');
  assert.ok(path[1]!.x < 60 - 8, 'it turned before the boulder');
  assert.ok(path[path.length - 1]!.x < path[1]!.x, 'it ended up back the way it came');
});

test('on ice the same push carries further', async () => {
  const { reaches } = await import('./sim.ts');
  const grass = reaches(false);
  const ice = reaches(true);
  for (let p = 1; p <= 6; p++) assert.ok(ice[p]! > grass[p]! * 1.5, `power ${p}`);
});

test('twist days: boulders on Wednesday, ice on Friday, both on Sunday, neither on Monday', () => {
  const has = (tier: number, what: 'rocks' | 'ice') => POOL[tier]!.every((l) => (what === 'ice' ? l.ice === true : (l.rocks?.length ?? 0) > 0));
  const none = (tier: number) => POOL[tier]!.every((l) => !l.ice && !l.rocks);
  assert.ok(none(0) && none(1) && none(3) && none(5));
  assert.ok(has(2, 'rocks') && !POOL[2]!.some((l) => l.ice));
  assert.ok(has(4, 'ice') && !POOL[4]!.some((l) => l.rocks));
  assert.ok(has(6, 'rocks') && has(6, 'ice'));
});

test('a player-made island is accepted with a winning line and refused when tampered with', async () => {
  const { checkLevel } = await import('./validate.ts');
  const good = POOL.flat().find((l) => checkLevel(l, l.solution).ok);
  assert.ok(good, 'some pool island passes the editor rules');
  const checked = checkLevel(good, good.solution);
  assert.ok(checked.ok && checked.level.par === runLevel(checked.level, good.solution).score, 'par is the score of the line it came with');

  const refuse = (level: unknown, solution: unknown, why: string) => assert.equal(checkLevel(level, solution).ok, false, why);
  refuse({ ...good, you: { x: 2, y: 2 } }, good.solution, 'you start in the sky');
  refuse({ ...good, foes: [...good.foes, { ...good.foes[0]!, x: good.foes[0]!.x + 3 }] }, good.solution, 'two foes overlap');
  refuse({ ...good, shape: good.shape.slice(1) }, good.solution, 'the outline is the wrong size');
  refuse({ ...good, foes: good.foes.map((f) => ({ x: f.x, y: f.y })) }, good.solution, 'a foe has no kind');
  refuse({ ...good, foes: good.foes.map((f) => ({ ...f, kind: 'bully' })) }, good.solution, 'a foe has a kind that does not exist');
  refuse(good, [], 'no line of moves came with it');
  refuse(good, Array.from({ length: good.turns }, () => ({ d: 0, p: 0 })).slice(0, good.solution.length), 'the line pushes nobody off or is unfinished');
  refuse({ ...good, rocks: [{ x: good.you.x, y: good.you.y, r: 8 }] }, good.solution, 'a boulder sits on a slime');
});

test('a slide judged safe never falls when it is really played', async () => {
  const { AIM_MOVES, isMoving, launch, slideEnd, step } = await import('./sim.ts');
  for (const tier of POOL)
    for (const l of tier.slice(0, 4)) {
      const solo = { ...l, foes: [] };
      for (const m of AIM_MOVES) {
        if (!slideEnd(solo, solo.you, m)) continue;
        const s = createState(solo);
        launch(s, [m]);
        while (isMoving(s)) step(s, solo);
        assert.ok(s.bodies[0]!.alive, `${l.id} ${JSON.stringify(m)}`);
      }
    }
});
