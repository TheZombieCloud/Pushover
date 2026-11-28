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

test('each day has its own rule: plain Monday, bumpers, boulders, cracked grass, ice and fences, wind and a bomb, boulders ice and a bomb', () => {
  const every = (tier: number, ok: (l: PoolLevel) => boolean) => POOL[tier]!.every(ok);
  const cracked = (l: PoolLevel) => l.shape.some((row) => row.includes('%'));
  const bomb = (l: PoolLevel) => l.foes.some((f) => f.kind === 'bomb');
  const plain = (l: PoolLevel) => !l.ice && !l.rocks && !l.bumpers && !l.fences && l.wind === undefined && !cracked(l) && !bomb(l);
  assert.ok(every(0, plain), 'Monday');
  assert.ok(every(1, (l) => !!l.bumpers?.length && !l.rocks && !l.ice), 'Tuesday');
  assert.ok(every(2, (l) => !!l.rocks?.length && !l.ice && !l.bumpers), 'Wednesday');
  assert.ok(every(3, (l) => cracked(l) && !l.ice && !l.rocks), 'Thursday');
  assert.ok(every(4, (l) => l.ice === true && !!l.fences?.length && !l.rocks), 'Friday');
  assert.ok(every(5, (l) => l.wind !== undefined && bomb(l) && !l.ice), 'Saturday');
  assert.ok(every(6, (l) => !!l.rocks?.length && l.ice === true && bomb(l)), 'Sunday');
});

test('every pool island has a bonus star its stored solution earns', () => {
  for (const tier of POOL)
    for (const l of tier) {
      assert.ok(l.star === 'spare' || l.star === 'combo', l.id);
      assert.equal(runLevel(l, l.solution).star, true, l.id);
    }
});

test('a slime that hits a bumper leaves faster than it arrived', async () => {
  const { lonePath } = await import('./sim.ts');
  const plain = lonePath({}, { x: 0, y: 0 }, { d: 0, p: 2 });
  const bumped = lonePath({ bumpers: [{ x: 18, y: 0 }] }, { x: 0, y: 0 }, { d: 0, p: 2 });
  const end = bumped[bumped.length - 1]!;
  assert.ok(end.x < 0, 'it was thrown back the way it came');
  assert.ok(-end.x > plain[plain.length - 1]!.x - 18, 'and further than it had left to go');
});

test('a fence bounces a slime back instead of letting it over the edge', async () => {
  const { slideEnd } = await import('./sim.ts');
  const shape = Array.from({ length: 22 }, (_, r) => (r >= 2 && r < 20 ? '..' + '#'.repeat(18) + '..' : '.'.repeat(22)));
  const level = { shape, you: { x: 88, y: 88 }, foes: [], turns: 1, par: 0 };
  const east = { d: 0, p: 6 };
  assert.equal(slideEnd(level, level.you, east), null, 'without a fence it goes over');
  const fenced = { ...level, fences: [{ x1: 160, y1: 16, x2: 160, y2: 160 }] };
  const end = slideEnd(fenced, fenced.you, east);
  assert.ok(end && end.x < 160 - 7, 'with one it stays on');
});

test('wind bends a slide', async () => {
  const { lonePath } = await import('./sim.ts');
  const calm = lonePath({}, { x: 0, y: 0 }, { d: 0, p: 6 });
  const windy = lonePath({ wind: 18 }, { x: 0, y: 0 }, { d: 0, p: 6 });
  assert.equal(calm[calm.length - 1]!.y, 0);
  assert.ok(windy[windy.length - 1]!.y > 4, 'blown south');
});

test('cracked grass falls away after a slime slides off it, and not while one stands on it', async () => {
  const { playTurn } = await import('./sim.ts');
  const rows = Array.from({ length: 22 }, (_, r) => (r >= 2 && r < 20 ? '..' + '#'.repeat(18) + '..' : '.'.repeat(22)));
  rows[11] = '..' + '#'.repeat(8) + '%%%%' + '#'.repeat(6) + '..';
  const level = { shape: rows, you: { x: 84, y: 92 }, foes: [{ x: 40, y: 40, kind: 'sleeper' as const }], turns: 3, par: 0 };
  const state = createState(level);
  playTurn(state, level, 0, { d: 0, p: 0 });
  assert.equal(state.gone, undefined, 'standing still breaks nothing');
  playTurn(state, level, 1, { d: 0, p: 4 });
  assert.ok((state.gone?.length ?? 0) > 0, 'the tiles it slid off are gone');
  assert.ok(state.bodies[0]!.alive, 'and it is still on the grass');
});

test('a bomb goes off when hit and throws its neighbours away', async () => {
  const { playTurn } = await import('./sim.ts');
  const shape = Array.from({ length: 22 }, (_, r) => (r >= 1 && r < 21 ? '.' + '#'.repeat(20) + '.' : '.'.repeat(22)));
  const foes = [{ x: 88, y: 88, kind: 'bomb' as const }, { x: 88, y: 108, kind: 'sleeper' as const }];
  const level = { shape, you: { x: 50, y: 88 }, foes, turns: 1, par: 0 };
  const state = createState(level);
  const events = playTurn(state, level, 0, { d: 0, p: 3 });
  assert.ok(events.some((e) => e.kind === 'boom'), 'it went off');
  assert.ok(state.bodies[1]!.spent, 'and only once');
  assert.ok(state.bodies[2]!.y > 108 + 10, 'the sleeper beside it was blown away');
  const quiet = { ...level, foes: foes.map((f) => ({ ...f, kind: 'sleeper' as const })) };
  const calm = createState(quiet);
  playTurn(calm, quiet, 0, { d: 0, p: 3 });
  assert.equal(calm.bodies[2]!.y, 108, 'a sleeper there would not have moved');
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
