import { context, reddit, redis } from '@devvit/web/server';
import { dayAfter, firstDay, todayId } from './days';
import { resetMine } from './game';

/*
 * "Delete my data": everything this subreddit's Pushover stores about one player.
 *
 *   me:{day}:{user} and their leaderboard place      every daily since the first
 *   streak:{user}, avatar:{user}
 *   followers, flair:ours                             their entry
 *   their user flair, only if it's the streak flair Pushover set
 *
 * Left alone: records on test posts and on player-made islands (their ids can't be
 * listed), and islands the player posted, which are posts in the community credited
 * to them by name: a moderator can remove those. Their comments are theirs.
 */

const MAX_DAYS = 1000;

export const deleteUserData = async (user: string): Promise<void> => {
  const end = dayAfter(todayId());
  for (let day = await firstDay(), i = 0; day <= end && i < MAX_DAYS; day = dayAfter(day), i++) {
    await resetMine(day, user);
  }

  const ours = await redis.hGet('flair:ours', user);
  const subredditName = context.subredditName;
  if (ours && subredditName) {
    try {
      const sub = await reddit.getCurrentSubreddit();
      const current = (await sub.getUserFlair({ usernames: [user] })).users[0]?.flairText ?? '';
      if (current === ours) await reddit.removeUserFlair(subredditName, user);
    } catch (error) {
      console.warn('flair removal failed', error);
    }
  }

  await redis.del(`streak:${user}`, `avatar:${user}`);
  await redis.hDel('followers', [user]);
  await redis.hDel('flair:ours', [user]);
};
