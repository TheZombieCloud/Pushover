/*
 * The user flair Pushover gives a player in its community: their stars and their
 * streak. The more bonus stars a player has collected, the grander the flair: more
 * stars in front, a title, and a richer colour.
 */

export type PlayerFlair = { text: string; backgroundColor: string; textColor: 'dark' | 'light' };

type Tier = { min: number; title: string; mark: string; backgroundColor: string; textColor: 'dark' | 'light' };

/** Highest first. A player with no stars yet keeps the plain streak flair. */
export const FLAIR_TIERS: Tier[] = [
  { min: 100, title: 'Island Legend', mark: '👑★', backgroundColor: '#1a1026', textColor: 'light' },
  { min: 50, title: 'Slime Royalty', mark: '👑', backgroundColor: '#6b3fa0', textColor: 'light' },
  { min: 25, title: 'Knockout', mark: '★★★', backgroundColor: '#e0457b', textColor: 'light' },
  { min: 10, title: 'Shover', mark: '★★', backgroundColor: '#ff9f1c', textColor: 'dark' },
  { min: 1, title: 'Pusher', mark: '★', backgroundColor: '#ffcd3c', textColor: 'dark' },
];

/** The flair for a player with this streak and this many stars, or null if they have neither. */
export const playerFlair = (streak: number, stars: number): PlayerFlair | null => {
  if (streak < 1 && stars < 1) return null;
  const tier = FLAIR_TIERS.find((t) => stars >= t.min);
  const days = streak > 0 ? `${streak}-day streak` : null;
  if (!tier) return { text: `Pushover · ${days}`, backgroundColor: '#ffcd3c', textColor: 'dark' };
  const parts = [`${tier.mark} ${stars}`, tier.title, days].filter((p): p is string => !!p);
  return { text: parts.join(' · '), backgroundColor: tier.backgroundColor, textColor: tier.textColor };
};
