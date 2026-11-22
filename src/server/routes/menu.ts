import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, reddit, redis } from '@devvit/web/server';
import { getPuzzle, puzzleIdForPost, resetMine, todayId } from '../core/game';
import { islandReport, statKeys } from '../core/stats';
import { createDailyPost, createTestPost } from '../core/post';

export const menu = new Hono();

const go = async (create: typeof createDailyPost) => {
  const post = await create();
  return `https://reddit.com/r/${context.subredditName}/comments/${post.id}`;
};

menu.post('/post-daily', async (c) => {
  try {
    return c.json<UiResponse>({ navigateTo: await go(createDailyPost) });
  } catch (error) {
    console.error('post-daily failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

menu.post('/post-test', async (c) => {
  try {
    return c.json<UiResponse>({ navigateTo: await go(createTestPost) });
  } catch (error) {
    console.error('post-test failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// Mods only: throw away today's island and post a fresh one from the current pool.
// Today's leaderboard and first-try counts go with it, and so does the mod's own
// record. Other players' records can't be listed (Redis can't enumerate keys), so
// this is meant for a day few people have played yet.
menu.post('/reroll-today', async (c) => {
  try {
    const pid = todayId();
    const username = await reddit.getCurrentUsername();
    if (username) await resetMine(pid, username);
    await redis.del(`puzzle:${pid}`, `lb:${pid}`, `first:${pid}`, ...statKeys(pid));
    return c.json<UiResponse>({ navigateTo: await go(createDailyPost) });
  } catch (error) {
    console.error('reroll-today failed', error);
    return c.json<UiResponse>({ showToast: 'Failed to re-roll today’s island' }, 400);
  }
});

// Testing aid (mods only, on a Pushover post): forget your record so the island plays fresh.
menu.post('/reset-me', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username || !context.postId) return c.json<UiResponse>({ showToast: 'Open this from a Pushover post' }, 400);
  if (!(await redis.get(`post:${context.postId}`))) return c.json<UiResponse>({ showToast: 'This isn’t a Pushover post' });
  const had = await resetMine(await puzzleIdForPost(context.postId), username);
  return c.json<UiResponse>({
    showToast: { text: had ? 'Reset. Reload the post to play fresh.' : 'Nothing to reset on this post.', appearance: 'success' },
  });
});

// Mods only, on a Pushover post: how that island is going (views, runs, falls, clears).
menu.post('/island-stats', async (c) => {
  if (!context.postId || !(await redis.get(`post:${context.postId}`))) {
    return c.json<UiResponse>({ showToast: 'Open this from a Pushover post' });
  }
  const puzzle = await getPuzzle(await puzzleIdForPost(context.postId));
  const name = puzzle.number > 0 ? `No. ${puzzle.number}` : puzzle.by ? `u/${puzzle.by}'s island` : 'this test island';
  return c.json<UiResponse>({
    showForm: {
      name: 'islandStats',
      form: { title: `Stats for ${name}`, description: await islandReport(puzzle), acceptLabel: 'Close', fields: [] },
    },
  });
});

// Anyone: delete everything Pushover stores about you here. Asks first; the form deletes.
menu.post('/delete-my-data', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<UiResponse>({ showToast: 'Log in first' }, 400);
  return c.json<UiResponse>({
    showForm: {
      name: 'deleteMyData',
      form: {
        title: 'Delete your Pushover data?',
        description: `This removes u/${username}'s runs, scores, streak and streak flair in r/${context.subredditName}. It can't be undone. Your comments stay; delete them yourself if you want.`,
        acceptLabel: 'Delete my data',
        fields: [],
      },
    },
  });
});
