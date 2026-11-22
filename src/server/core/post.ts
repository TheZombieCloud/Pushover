import { reddit, redis } from '@devvit/web/server';
import type { Puzzle } from '../../shared/api';
import { WEEKDAY_NAMES, WEEKDAYS } from '../../shared/pool';
import { twistOf } from '../../shared/twist';
import { getPuzzle, linkPost, randomTestPuzzle, savePuzzle, todayId } from './game';

const dayName = (short: string) => WEEKDAY_NAMES[WEEKDAYS.findIndex((d) => d === short)] ?? short;

const goal = (p: Puzzle) => `push ${p.level.foes.length} slimes off in ${p.level.turns} turns`;

const createPuzzlePost = async (puzzle: Puzzle, title: string) => {
  const post = await reddit.submitCustomPost({
    title,
    textFallback: {
      text: `Pushover: ${goal(puzzle)}. Everyone's moves are shown as arrows; plan yours and push them off the island.`,
    },
  });
  await linkPost(post.id, puzzle.id);
  return post;
};

/** Today's daily island (used by the scheduler, install trigger and mod menu). */
export const createDailyPost = async () => {
  const puzzle = await getPuzzle(todayId());
  const twist = twistOf(puzzle.level);
  const post = await createPuzzlePost(puzzle, `Pushover No. ${puzzle.number} · ${dayName(puzzle.weekday)}${twist ? ` · ${twist.name}` : ''}: ${goal(puzzle)}`);
  await redis.set(`posted:${puzzle.id}`, post.id);
  return post;
};

/**
 * Posts today's island unless it is already up. The scheduler calls this at midnight
 * UTC and again every 15 minutes, so a missed or failed run is caught up the same day.
 *
 *   posted:{day}   string   id of the daily post made for that day ("pending:…" while
 *                           one is being made, so two runs at once can't both post)
 */
export const ensureDailyPost = async (): Promise<string | null> => {
  const day = todayId();
  const key = `posted:${day}`;
  if (await redis.get(key)) return null;
  // From before this record was kept: a day whose island is already frozen has been
  // posted (the island is frozen when its post is made).
  if (await redis.hGet(`puzzle:${day}`, 'level')) {
    await redis.set(key, 'earlier');
    return null;
  }
  const claim = `pending:${Date.now()}:${Math.random()}`;
  await redis.set(key, claim, { nx: true });
  if ((await redis.get(key)) !== claim) return null;
  try {
    return (await createDailyPost()).id;
  } catch (error) {
    // Let the next check try again.
    await redis.del(key);
    throw error;
  }
};

/** An island a player made in the editor, as a post of its own. */
export const createIslandPost = async (puzzle: Puzzle) => {
  const twist = twistOf(puzzle.level);
  return createPuzzlePost(puzzle, `Pushover island by u/${puzzle.by ?? 'someone'}${twist ? ` (${twist.name})` : ''}: ${goal(puzzle)}`);
};

/** A random island with its own fresh leaderboard, for playtesting. */
export const createTestPost = async () => {
  const puzzle = randomTestPuzzle();
  await savePuzzle(puzzle);
  return createPuzzlePost(puzzle, `Pushover (test, ${dayName(puzzle.weekday)} difficulty): ${goal(puzzle)}`);
};
