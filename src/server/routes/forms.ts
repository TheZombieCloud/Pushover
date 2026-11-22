import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { deleteUserData } from '../core/privacy';

export const forms = new Hono();

// The stats form only shows a report; closing it does nothing.
forms.post('/island-stats', (c) => c.json<UiResponse>({}));

forms.post('/delete-my-data', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return c.json<UiResponse>({ showToast: 'Log in first' }, 400);
  try {
    await deleteUserData(username);
    return c.json<UiResponse>({ showToast: { text: 'Your Pushover data is deleted', appearance: 'success' } });
  } catch (error) {
    console.error('delete-my-data failed', error);
    return c.json<UiResponse>({ showToast: 'Couldn’t delete your data. Try again' }, 400);
  }
});
