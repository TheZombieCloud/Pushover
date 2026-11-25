import { reddit, redis } from '@devvit/web/server';
import type { Puzzle } from '../../shared/api';
import { WEEKDAY_NAMES, WEEKDAYS } from '../../shared/pool';
import { twistOf } from '../../shared/twist';
import { getPuzzle, linkPost, randomTestPuzzle, savePuzzle, todayId } from './game';

const dayName = (short: string) => WEEKDAY_NAMES[WEEKDAYS.findIndex((d) => d === short)] ?? short;

const goal = (p: Puzzle) => `push ${p.level.foes.length} slimes off in ${p.level.turns} turns`;

const fallback = (puzzle: Puzzle) => ({
  text: `Pushover: ${goal(puzzle)}. Everyone's moves are shown as arrows; plan yours and push them off the island.`,
});

const SCORES_TEXT =
  'Scores for this island go in the replies to this comment. After a run, press "Comment my score" to add yours.';

const isCommentId = (id: string | undefined): id is `t1_${string}` => !!id && id.startsWith('t1_');

/**
 * The one stickied comment on a game post that score comments are replies to.
 *
 *   sticky:{postId}   string   id of that comment
 *
 * With `check`, a stored comment is looked up first and replaced if it is gone
 * (used after a reply to it failed).
 */
export const scoreThread = async (postId: `t3_${string}`, check = false): Promise<`t1_${string}`> => {
  const key = `sticky:${postId}`;
  const stored = await redis.get(key);
  if (isCommentId(stored)) {
    if (!check) return stored;
    try {
      const existing = await reddit.getCommentById(stored);
      if (!existing.removed) return stored;
    } catch (error) {
      console.warn('scores comment is gone, making a new one', error);
    }
  }
  const comment = await reddit.submitComment({ id: postId, text: SCORES_TEXT, runAs: 'APP' });
  await comment.distinguish(true);
  await redis.set(key, comment.id);
  return comment.id;
};

const BACKFILL_SCAN = 300;
const BACKFILL_BATCH = 25;

/**
 * For posts made before the scores comment existed: go through the community's newest
 * posts and give every Pushover post that has none its stickied scores comment. Does
 * a batch at a time so a request can't run long; `more` says to run it again.
 */
export const backfillScoreThreads = async (subredditName: string): Promise<{ added: number; had: number; more: boolean }> => {
  const posts = await reddit.getNewPosts({ subredditName, limit: BACKFILL_SCAN, pageSize: 100 }).all();
  let added = 0;
  let had = 0;
  for (const post of posts) {
    if (!(await redis.get(`post:${post.id}`))) continue; // not a Pushover post
    if (await redis.get(`sticky:${post.id}`)) {
      had++;
      continue;
    }
    if (added >= BACKFILL_BATCH) return { added, had, more: true };
    await scoreThread(post.id);
    added++;
  }
  return { added, had, more: false };
};

/**
 * Daily and test islands are posted by the app. An island a player built is posted
 * from that player's own account (`asPlayer`), so it is theirs to delete and can be
 * reported like any other post.
 */
const createPuzzlePost = async (puzzle: Puzzle, title: string, asPlayer = false) => {
  const post = asPlayer
    ? await reddit.submitCustomPost({ title, textFallback: fallback(puzzle), runAs: 'USER', userGeneratedContent: { text: title } })
    : await reddit.submitCustomPost({ title, textFallback: fallback(puzzle) });
  await linkPost(post.id, puzzle.id);
  try {
    await scoreThread(post.id);
  } catch (error) {
    // Made again the first time someone comments their score.
    console.warn('scores comment failed', error);
  }
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
  return createPuzzlePost(puzzle, `Pushover island by u/${puzzle.by ?? 'someone'}${twist ? ` (${twist.name})` : ''}: ${goal(puzzle)}`, true);
};

/** A random island with its own fresh leaderboard, for playtesting. */
export const createTestPost = async () => {
  const puzzle = randomTestPuzzle();
  await savePuzzle(puzzle);
  return createPuzzlePost(puzzle, `Pushover (test, ${dayName(puzzle.weekday)} difficulty): ${goal(puzzle)}`);
};
