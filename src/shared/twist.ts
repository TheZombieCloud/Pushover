import type { Terrain } from './sim.ts';

/** What's different about an island, in a name and one short rule. */
export type Twist = { name: string; rule: string };

export const twistOf = (t: Terrain): Twist | null => {
  const rocks = (t.rocks?.length ?? 0) > 0;
  if (t.ice && rocks) return { name: 'Frozen boulders', rule: 'Ice: everything slides further, and bounces off boulders.' };
  if (t.ice) return { name: 'Frozen', rule: 'Ice: everything slides further.' };
  if (rocks) return { name: 'Boulders', rule: 'Slimes bounce off the boulders.' };
  return null;
};
