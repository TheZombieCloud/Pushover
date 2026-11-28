import type { Terrain } from './sim.ts';

/** What's different about an island, in a name and one short rule. */
export type Twist = { name: string; rule: string };

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** Where the wind blows to, as a compass point. */
export const windName = (d: number): string => COMPASS[Math.round((((d % 72) + 72) % 72) / 9) % 8]!;

export const twistOf = (t: Terrain & { shape?: string[] }): Twist | null => {
  const parts: Twist[] = [];
  const rocks = (t.rocks?.length ?? 0) > 0;
  if (t.ice && rocks) parts.push({ name: 'Frozen boulders', rule: 'Ice: everything slides further, and bounces off boulders.' });
  else if (t.ice) parts.push({ name: 'Frozen', rule: 'Ice: everything slides further.' });
  else if (rocks) parts.push({ name: 'Boulders', rule: 'Slimes bounce off the boulders.' });
  if (t.bumpers?.length) parts.push({ name: 'Bumpers', rule: 'Bumpers fling back whoever hits them.' });
  if (t.fences?.length) parts.push({ name: 'Fences', rule: 'Fences bounce slimes back from the edge.' });
  if (t.wind !== undefined) parts.push({ name: 'Windy', rule: `Wind blows ${windName(t.wind)}: every slide drifts with it.` });
  if (t.shape?.some((row) => row.includes('%'))) parts.push({ name: 'Crumbling', rule: 'Cracked grass falls away once a slime slides off it.' });
  if (!parts.length) return null;
  return { name: parts.map((p) => p.name).join(', '), rule: parts.map((p) => p.rule).join(' ') };
};
