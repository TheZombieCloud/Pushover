import { redis } from '@devvit/web/server';
import type { Puzzle } from '../../shared/api';
import type { RunResult } from '../../shared/sim';

/*
 * Per-island counters, so a mod can see how an island is going: is it too hard, do
 * people open it and leave. Anonymous tallies only: no usernames.
 *
 *   stats:{pid}   hash   views      feed card loads
 *                        opens      game screen loads
 *                        started    runs begun (first push made)
 *                        runs       runs finished
 *                        fell       finished runs that ended with the player falling off
 *                        clears     players who have pushed every foe off
 *                        clearRuns  runs those players needed, added up
 *
 * Players and first-try scores are already kept by lb:{pid} and first:{pid} (game.ts).
 * Counting must never break play, so every write swallows its own errors.
 */

export type StatField = 'views' | 'opens' | 'started' | 'runs' | 'fell' | 'clears' | 'clearRuns';

const quietly = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.warn('stats write failed', error);
  }
};

export const count = (pid: string, field: StatField, by = 1) => quietly(() => redis.hIncrBy(`stats:${pid}`, field, by));

/** A finished run. `clearedAt` is the run number if this run is the player's first clear. */
export const countRun = async (puzzle: Puzzle, result: RunResult, clearedAt: number | null) => {
  await count(puzzle.id, 'runs');
  if (result.fell) await count(puzzle.id, 'fell');
  if (clearedAt !== null) {
    await count(puzzle.id, 'clears');
    await count(puzzle.id, 'clearRuns', clearedAt);
  }
};

export const statKeys = (pid: string): string[] => [`stats:${pid}`];

/** A plain-text report for the mod menu. */
export const islandReport = async (puzzle: Puzzle): Promise<string> => {
  const [stats, first, players] = await Promise.all([
    redis.hGetAll(`stats:${puzzle.id}`),
    redis.hGetAll(`first:${puzzle.id}`),
    redis.zCard(`lb:${puzzle.id}`),
  ]);
  const n = (k: StatField) => Math.max(0, Number(stats[k] ?? 0));
  const foes = puzzle.level.foes.length;
  const share = (part: number, whole: number) => (whole > 0 ? ` (${Math.round((part / whole) * 100)}%)` : '');
  const lines = [
    `Feed card loads: ${n('views')}`,
    `Game opens: ${n('opens')}`,
    `Players who finished a run: ${players}`,
  ];
  const firsts = Array.from({ length: foes + 1 }, (_, s) => Math.max(0, Number(first[String(s)] ?? 0)));
  const firstTotal = firsts.reduce((a, b) => a + b, 0);
  if (firstTotal > 0) lines.push(`First try: ${firsts.map((c, s) => `${s} of ${foes} × ${c}${share(c, firstTotal)}`).join(', ')}`);
  // Runs from before these counters existed were never counted.
  if (n('runs') > 0) {
    lines.push(
      `Runs started: ${n('started')}`,
      `Runs finished: ${n('runs')}`,
      `Left mid-run: ${Math.max(0, n('started') - n('runs'))}`,
      `Runs that ended in a fall: ${n('fell')}${share(n('fell'), n('runs'))}`,
      `Players who pushed all ${foes} off: ${n('clears')}${share(n('clears'), players)}`
    );
    if (n('clears') > 0) lines.push(`Runs they needed, on average: ${(n('clearRuns') / n('clears')).toFixed(1)}`);
  } else {
    lines.push('Runs, falls and clears: nothing counted yet (only runs played after this report was added count)');
  }
  return lines.join('\n');
};
