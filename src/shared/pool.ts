import type { Level, Move } from './sim.ts';
import poolJson from './levels.json' with { type: 'json' };

/*
 * The daily island pool (built by scripts/build-levels.ts): 7 tiers, one per weekday,
 * Monday easiest. Every community gets the same island on the same UTC day, so scores
 * compare across communities. A tier cycles once a year.
 */

export type PoolLevel = Level & { id: string; tier: number; rate: number; solution: Move[] };

const POOL: PoolLevel[][] = poolJson as PoolLevel[][];

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const DAY_MS = 86_400_000;

/** 0 = Monday … 6 = Sunday, for a YYYY-MM-DD day id (UTC). */
export const tierOf = (dayId: string): number => (new Date(`${dayId}T00:00:00Z`).getUTCDay() + 6) % 7;

export const dailyPoolLevel = (dayId: string): PoolLevel => {
  const tier = POOL[tierOf(dayId)]!;
  const week = Math.floor(Date.parse(`${dayId}T00:00:00Z`) / DAY_MS / 7);
  return tier[((week % tier.length) + tier.length) % tier.length]!;
};

export const randomPoolLevel = (rand: () => number): PoolLevel => {
  const tier = POOL[Math.floor(rand() * POOL.length)]!;
  return tier[Math.floor(rand() * tier.length)]!;
};

export const poolLevelById = (id: string): PoolLevel | null => {
  for (const tier of POOL) for (const l of tier) if (l.id === id) return l;
  return null;
};

/** The level as players see it (no stored solution or tuning data). */
export const playable = (l: PoolLevel): Level => ({
  shape: l.shape,
  you: l.you,
  foes: l.foes,
  turns: l.turns,
  par: l.par,
  ...(l.rocks ? { rocks: l.rocks } : {}),
  ...(l.ice ? { ice: true } : {}),
});
