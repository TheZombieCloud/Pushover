import { Hono, type Context } from 'hono';
import { telemetry } from '@devvit/analytics/server/reddit';
import type { Puzzle } from '../../shared/api';
import type { RunResult } from '../../shared/sim';

/*
 * Devvit Journeys: one journey per run of an island.
 *
 *   App.Ready           client, when the game screen is interactive
 *   Journey.Start       client, on the first push of a run
 *   Journey.Progress    server, after each turn (replayed here, so it can't be faked)
 *   Journey.Interaction client, for share, leaderboard, replay, follow, build, play again
 *   Journey.End         server, when a finished run is recorded (score = slimes pushed
 *                       off; a win is pushing every one of them off)
 *
 * The client sends its journey id in the x-devvit-journey-id header.
 * Telemetry must never break play, so every call swallows its own errors.
 */

const safely = async (what: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (error) {
    console.warn(`telemetry ${what} failed`, error);
  }
};

const journeyIdOf = (c: Context) => c.req.header('x-devvit-journey-id') ?? '';

export const trackTurn = (c: Context, puzzle: Puzzle, turnsPlayed: number, outs: number) => {
  const journeyId = journeyIdOf(c);
  if (!journeyId) return Promise.resolve();
  return safely('progress', () =>
    telemetry.journeyProgress({
      journeyId,
      progress: Math.min(0.95, turnsPlayed / Math.max(1, puzzle.level.turns)),
      action: 'turn',
      actionDetails: `${puzzle.id} turn_${turnsPlayed} out_${outs}`,
    })
  );
};

export const trackEnd = (c: Context, puzzle: Puzzle, result: RunResult) => {
  const journeyId = journeyIdOf(c);
  if (!journeyId) return Promise.resolve();
  return safely('end', () =>
    telemetry.endJourney({ journeyId, complete: true, game: { win: result.score === puzzle.level.foes.length, score: result.score } })
  );
};

const unrecorded = { receipt: { status: 'JOURNEY_RECEIPT_UNSPECIFIED', message: 'Not recorded' } };

const text = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 64) : '');

/**
 * The endpoints @devvit/analytics/client/reddit posts to (its own router is Express;
 * this app is Hono). Mounted at /api/telemetry.
 */
export const journeyRoutes = new Hono();

journeyRoutes.post('/journey/start', async (c) => {
  try {
    return c.json(await telemetry.startJourney());
  } catch (error) {
    console.warn('telemetry start failed', error);
    return c.json({ journeyId: '', ...unrecorded });
  }
});

journeyRoutes.post('/journey/app-ready', async (c) => {
  try {
    return c.json(await telemetry.appReady());
  } catch (error) {
    console.warn('telemetry app-ready failed', error);
    return c.json(unrecorded);
  }
});

journeyRoutes.post('/journey/interaction', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const field = (k: string) => (typeof body === 'object' && body !== null && k in body ? text(Reflect.get(body, k)) : '');
  const action = field('action');
  if (!action) return c.json({ error: 'action is required.', ...unrecorded }, 400);
  try {
    return c.json(
      await telemetry.journeyInteraction({ journeyId: field('journeyId'), action, actionDetails: field('actionDetails') })
    );
  } catch (error) {
    console.warn('telemetry interaction failed', error);
    return c.json(unrecorded);
  }
});
