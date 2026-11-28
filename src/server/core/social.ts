import { context, reddit, redis } from '@devvit/web/server';
import { playerFlair } from '../../shared/flair';

/*
 * Two small ties back into the subreddit:
 *
 *   followers   hash  username -> '1' once they tapped Follow on the results sheet
 *   flair:ours  hash  username -> the flair text (streak and stars) we last set for them
 *
 * Pushover's flair is only ever written over flair we set ourselves (or no flair), so a
 * flair the member picked, or a mod gave them, is never replaced.
 */

export const isFollowing = async (username: string): Promise<boolean> =>
  (await redis.hGet('followers', username)) === '1';

/** True if subscribed. False if Reddit hasn't granted the app SUBSCRIBE_TO_SUBREDDIT. */
export const follow = async (username: string): Promise<boolean> => {
  try {
    await reddit.subscribeToCurrentSubreddit();
  } catch (error) {
    if (String(error).includes('permission not granted')) return false;
    throw error;
  }
  await redis.hSet('followers', { [username]: '1' });
  return true;
};



/** Remove the streak flair, only if it is still the one Pushover set. */
export const removeStreakFlair = async (username: string): Promise<void> => {
  const ours = await redis.hGet('flair:ours', username);
  const subredditName = context.subredditName;
  if (ours && subredditName) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      const current = (await sub.getUserFlair({ usernames: [username] })).users[0]?.flairText ?? '';
      if (current === ours) await reddit.removeUserFlair(subredditName, username);
    } catch (error) {
      console.warn('flair removal failed', error);
    }
  }
  await redis.hDel('flair:ours', [username]);
};

/** Set the player's flair to their stars and streak (see shared/flair.ts). */
export const updatePlayerFlair = async (username: string, streak: number, stars: number): Promise<void> => {
  const subredditName = context.subredditName;
  const flair = playerFlair(streak, stars);
  if (!subredditName || !flair) return;
  try {
    const { text, backgroundColor, textColor } = flair;
    const [ours, sub] = await Promise.all([redis.hGet('flair:ours', username), reddit.getCurrentSubreddit()]);
    const current = (await sub.getUserFlair({ usernames: [username] })).users[0]?.flairText ?? '';
    if (current === text) return;
    if (current && current !== ours) return; // their own flair: leave it alone
    await reddit.setUserFlair({ subredditName, username, text, backgroundColor, textColor });
    await redis.hSet('flair:ours', { [username]: text });
  } catch (error) {
    console.warn('streak flair failed', error);
  }
};
