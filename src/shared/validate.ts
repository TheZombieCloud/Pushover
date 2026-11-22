import { COLS, FOE_KINDS, MAX_FOES, MAX_ROCKS, MAX_TURNS, RADIUS, ROCK_SIZES, ROWS, isGround, isValidMove, runLevel } from './sim.ts';
import type { Foe, Level, Move, Rock, Spot } from './sim.ts';

/*
 * The rules a player-made island must pass. The editor uses the small checks
 * (canStand, rockFits, clearOf) so a draft is never invalid, and the server runs
 * checkLevel on whatever it is sent before it creates a post. The maker's own
 * line of moves comes with the island: replayed here, it proves the island can be
 * beaten, and its score becomes the island's par. Foes have a kind and nothing
 * else: how they move is the game's business, not the maker's.
 */

/** Fewest and most turns the editor offers. */
export const EDIT_TURNS = [2, 4] as const;
/** Closest two slime centres may start. */
export const MIN_GAP = RADIUS * 2 + 2;
/** Fewest grass cells an island needs. */
const MIN_CELLS = 30;

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Positions snap to half pixels, which is exact in floating point. */
const snap = (v: number) => Math.round(v * 2) / 2;

const AROUND: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

/** A slime can start here: on the grass, with a little room on every side. */
export const canStand = (shape: string[], s: Spot): boolean => AROUND.every(([dx, dy]) => isGround(shape, s.x + dx * 5, s.y + dy * 5));

/** A boulder fits here: wholly on the grass. */
export const rockFits = (shape: string[], rock: Rock): boolean =>
  AROUND.every(([dx, dy]) => isGround(shape, rock.x + dx * (rock.r + 1), rock.y + dy * (rock.r + 1)));

const apart = (a: Spot, b: Spot) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** Is this spot clear of the other slimes and of every boulder? */
export const clearOf = (s: Spot, slimes: Spot[], rocks: Rock[]): boolean =>
  slimes.every((o) => apart(s, o) >= MIN_GAP) && rocks.every((r) => apart(s, r) >= RADIUS + r.r + 1);

/** Is this boulder clear of every slime and every other boulder? */
export const rockClearOf = (rock: Rock, slimes: Spot[], rocks: Rock[]): boolean =>
  slimes.every((o) => apart(rock, o) >= RADIUS + rock.r + 1) && rocks.every((r) => apart(rock, r) >= rock.r + r.r + 2);

const parseSpot = (v: unknown): Spot | null => (isRecord(v) && isNumber(v.x) && isNumber(v.y) ? { x: snap(v.x), y: snap(v.y) } : null);

export type Checked = { ok: true; level: Level; solution: Move[] } | { ok: false; error: string };
const no = (error: string): Checked => ({ ok: false, error });

/** Check an island someone made, and the line of moves they beat it with. */
export const checkLevel = (raw: unknown, rawSolution: unknown): Checked => {
  if (!isRecord(raw)) return no('That isn’t an island');

  // The outline: ROWS rows of COLS cells, sky all round the border.
  const rows = raw.shape;
  if (!Array.isArray(rows) || rows.length !== ROWS) return no('The island has the wrong size');
  const shape: string[] = [];
  let cells = 0;
  for (let r = 0; r < ROWS; r++) {
    const row: unknown = rows[r];
    if (typeof row !== 'string' || row.length !== COLS || /[^#.]/.test(row)) return no('The island has the wrong size');
    if ((r === 0 || r === ROWS - 1) && row.includes('#')) return no('Leave sky around the island');
    if (row[0] === '#' || row[COLS - 1] === '#') return no('Leave sky around the island');
    for (const c of row) if (c === '#') cells++;
    shape.push(row);
  }
  if (cells < MIN_CELLS) return no('The island is too small');

  const turns = raw.turns;
  if (!isNumber(turns) || !Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) return no('Pick a number of turns');

  const you = parseSpot(raw.you);
  if (!you || !canStand(shape, you)) return no('Your slime needs to start on the grass');

  if (!Array.isArray(raw.foes) || raw.foes.length < 1 || raw.foes.length > MAX_FOES) return no(`Add 1 to ${MAX_FOES} foes`);
  const foes: Foe[] = [];
  for (const f of raw.foes) {
    const spot = parseSpot(f);
    const kind = isRecord(f) ? FOE_KINDS.find((k) => k === f.kind) : undefined;
    if (!spot || !kind || !canStand(shape, spot)) return no('Every foe needs a type and a start on the grass');
    foes.push({ ...spot, kind });
  }

  const rocks: Rock[] = [];
  if (raw.rocks !== undefined) {
    if (!Array.isArray(raw.rocks) || raw.rocks.length > MAX_ROCKS) return no(`At most ${MAX_ROCKS} boulders`);
    for (const k of raw.rocks) {
      const spot = parseSpot(k);
      const r = isRecord(k) ? k.r : null;
      const size = ROCK_SIZES.find((s) => s === r);
      if (!spot || size === undefined) return no('That isn’t a boulder');
      const rock: Rock = { ...spot, r: size };
      if (!rockFits(shape, rock) || !rockClearOf(rock, [], rocks)) return no('Boulders need to sit on the grass, apart from each other');
      rocks.push(rock);
    }
  }

  const slimes: Spot[] = [you, ...foes];
  for (let i = 0; i < slimes.length; i++) {
    const others = slimes.filter((_, j) => j !== i);
    if (!clearOf(slimes[i]!, others, rocks)) return no('Slimes need a little room between them and the boulders');
  }

  const level: Level = {
    shape,
    you,
    foes,
    turns,
    par: 0,
    ...(rocks.length ? { rocks } : {}),
    ...(raw.ice === true ? { ice: true } : {}),
  };

  // The maker's own line proves it can be beaten, and sets par.
  if (!Array.isArray(rawSolution) || rawSolution.length < 1 || rawSolution.length > turns) return no('Play your island through first');
  const solution: Move[] = [];
  for (const m of rawSolution) {
    if (!isValidMove(m)) return no('Play your island through first');
    solution.push({ d: m.d, p: m.p });
  }
  const run = runLevel(level, solution);
  if (!run.complete || run.turnsPlayed !== solution.length) return no('Play your island through first');
  if (run.fell) return no('You fell off in your own run. Change your moves');
  if (run.score < 1) return no('Push at least one slime off to post it');
  // The player has to matter: standing still all game must do worse than the maker did.
  const idle = runLevel(level, Array.from({ length: turns }, () => ({ d: 0, p: 0 })));
  if (idle.score >= run.score) return no('The foes knock each other off without you. Move them apart');
  return { ok: true, level: { ...level, par: run.score }, solution };
};
