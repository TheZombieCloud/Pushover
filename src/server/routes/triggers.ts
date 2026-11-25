import { Hono } from 'hono';
import type { OnPostDeleteRequest, TriggerResponse } from '@devvit/web/shared';
import { forgetPost } from '../core/game';
import { createDailyPost } from '../core/post';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const post = await createDailyPost();
    return c.json<TriggerResponse>({ status: 'success', message: `Created daily post ${post.id}` });
  } catch (error) {
    console.error('install post failed', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});

// A post was deleted or removed (by its author, a moderator or Reddit).
triggers.post('/on-post-delete', async (c) => {
  try {
    const event = await c.req.json<OnPostDeleteRequest>();
    await forgetPost(event.postId);
    return c.json<TriggerResponse>({ status: 'success' });
  } catch (error) {
    console.error('post delete cleanup failed', error);
    return c.json<TriggerResponse>({ status: 'error', message: 'Cleanup failed' }, 400);
  }
});
