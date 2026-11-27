import { redis } from '@devvit/web/server';
import { dayAfter, firstDay, todayId } from './days';
import { resetMine } from './game';
import { removeStreakFlair } from './social';

/*
 * "Delete my data": everything this subreddit's Pushover stores about one player.
 *
 *   me:{day}:{user} and their leaderboard place      every daily since the first
 *   streak:{user}, avatar:{user}, pushed:{user}
 *   followers, flair:ours                             their entry
 *   their user flair, only if it's the streak flair Pushover set
 *
 * Left alone: records on test posts and on player-made islands (their ids can't be
 * listed). Islands the player posted and their score comments are their own posts and
 * comments on Reddit, which they delete there; deleting an island post also deletes
 * the island and its records here (forgetPost in game.ts).
 */

const MAX_DAYS = 1000;

export const deleteUserData = async (user: string): Promise<void> => {
  const end = dayAfter(todayId());
  for (let day = await firstDay(), i = 0; day <= end && i < MAX_DAYS; day = dayAfter(day), i++) {
    await resetMine(day, user);
  }

  await removeStreakFlair(user);
  await redis.del(`streak:${user}`, `avatar:${user}`, `pushed:${user}`);
  await redis.hDel('followers', [user]);
};
