import { Hono, type Context } from 'hono';
import { context, reddit } from '@devvit/web/server';
import type {
  ErrorResponse,
  FollowResponse,
  InitResponse,
  IslandsResponse,
  LeaderboardResponse,
  MakeResponse,
  ReplayResponse,
  RunResponse,
  ShareResponse,
} from '../../shared/api';
import { WEEKDAY_NAMES, WEEKDAYS } from '../../shared/pool';
import { runLevel } from '../../shared/sim';
import { checkLevel } from '../../shared/validate';
import {
  MADE_PER_DAY,
  createIsland,
  getBestMoves,
  getMine,
  getPuzzle,
  getStreak,
  latestIslands,
  leaderboard,
  listIsland,
  madeToday,
  myRow,
  parseMoves,
  playerCount,
  puzzleIdForPost,
  recordRun,
  standing,
} from '../core/game';
import { journeyRoutes, trackEnd, trackTurn } from '../core/journey';
import { createIslandPost, scoreThread } from '../core/post';
import { count, countRun } from '../core/stats';
import { follow, isFollowing, updateStreakFlair } from '../core/social';

export const api = new Hono();

api.route('/telemetry', journeyRoutes);

const fail = (c: Context, message: string, code: 400 | 401 | 404 = 400) =>
  c.json<ErrorResponse>({ status: 'error', message }, code);

const current = async () => {
  const [username, pid] = await Promise.all([reddit.getCurrentUsername(), puzzleIdForPost(context.postId)]);
  return { username: username ?? null, puzzle: await getPuzzle(pid) };
};

api.get('/init', async (c) => {
  const { username, puzzle } = await current();
  await count(puzzle.id, c.req.query('from') === 'card' ? 'views' : 'opens');
  const [players, leaders] = await Promise.all([playerCount(puzzle.id), leaderboard(puzzle.id, 0, 0)]);
  const base = { username, puzzle, players, best: leaders[0] ?? null, subreddit: context.subredditName ?? '' };
  if (!username) return c.json<InitResponse>({ ...base, streak: 0, standing: null, following: false });
  const [mine, streak, following] = await Promise.all([getMine(puzzle.id, username), getStreak(username), isFollowing(username)]);
  return c.json<InitResponse>({
    ...base,
    streak,
    following,
    standing: mine ? await standing(puzzle, username, mine) : null,
  });
});

// After each turn: replay what's been played so far and report journey progress.
api.post('/turn', async (c) => {
  const { puzzle } = await current();
  const body = await c.req.json<{ moves?: unknown }>().catch(() => ({ moves: null }));
  const moves = parseMoves(body.moves, puzzle.level);
  if (!moves) return fail(c, 'Bad moves');
  const r = runLevel(puzzle.level, moves);
  if (moves.length === 1) await count(puzzle.id, 'started');
  await trackTurn(c, puzzle, r.turnsPlayed, r.outs);
  return c.json({ ok: true });
});

// A finished run: replay it, score it, keep the best.
api.post('/run', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to play', 401);
  const body = await c.req.json<{ moves?: unknown }>().catch(() => ({ moves: null }));
  const moves = parseMoves(body.moves, puzzle.level);
  if (!moves) return fail(c, 'Bad moves');
  const out = await recordRun(puzzle, username, moves);
  if (!out.ok) return fail(c, out.error);
  await trackEnd(c, puzzle, out.result);
  // A player's best only improves to a full clear once: that run is their first clear.
  await countRun(puzzle, out.result, out.improved && out.result.score === puzzle.level.foes.length ? out.mine.runs : null);
  const streak = await getStreak(username);
  if (out.first && puzzle.number > 0) await updateStreakFlair(username, streak);
  return c.json<RunResponse>({
    result: out.result,
    standing: await standing(puzzle, username, out.mine),
    streak,
    improved: out.improved,
  });
});

api.get('/leaderboard', async (c) => {
  const { username, puzzle } = await current();
  const [rows, you] = await Promise.all([
    leaderboard(puzzle.id, 0, 49),
    username ? myRow(puzzle.id, username) : Promise.resolve(null),
  ]);
  return c.json<LeaderboardResponse>({ rows, you });
});

// Your best run on this island, to watch again.
api.get('/replay', async (c) => {
  const { username, puzzle } = await current();
  return c.json<ReplayResponse>({ moves: username ? await getBestMoves(puzzle.id, username) : null });
});

// A player posts an island they made. It arrives with the maker's own line of moves:
// replayed here, that proves the island can be beaten.
api.post('/levels', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return fail(c, 'Log in to post an island', 401);
  if ((await madeToday(username)) >= MADE_PER_DAY) return fail(c, `That’s ${MADE_PER_DAY} islands today. Post more tomorrow`);
  const body = await c.req.json<{ level?: unknown; solution?: unknown }>().catch(() => ({ level: null, solution: null }));
  const checked = checkLevel(body.level, body.solution);
  if (!checked.ok) return fail(c, checked.error);
  try {
    const puzzle = await createIsland(checked.level, username);
    const post = await createIslandPost(puzzle);
    const url = `https://reddit.com/r/${context.subredditName}/comments/${post.id}`;
    await listIsland(post.id, puzzle, url);
    return c.json<MakeResponse>({ ok: true, url });
  } catch (error) {
    console.error('posting an island failed', error);
    return fail(c, 'Couldn’t post the island. Try again');
  }
});

// The newest player-made islands, for the results sheet.
api.get('/islands', async (c) => c.json<IslandsResponse>({ islands: await latestIslands(context.postId) }));

const dayName = (short: string) => WEEKDAY_NAMES[WEEKDAYS.findIndex((d) => d === short)] ?? short;

api.post('/share', async (c) => {
  const { username, puzzle } = await current();
  if (!username) return fail(c, 'Log in to share', 401);
  const mine = await getMine(puzzle.id, username);
  if (!mine) return fail(c, 'Finish a run first');
  const postId = context.postId;
  if (!postId) return fail(c, 'No post to comment on', 404);
  const foes = puzzle.level.foes.length;
  const me = await myRow(puzzle.id, username);
  const players = await playerCount(puzzle.id);
  const label = puzzle.number > 0 ? `Pushover No. ${puzzle.number} · ${dayName(puzzle.weekday)}` : 'Pushover';
  const pips = '🟨'.repeat(mine.best) + '⬛'.repeat(Math.max(0, foes - mine.best));
  const top = me && players > 1 ? ` · top ${Math.max(1, Math.ceil((me.rank / players) * 100))}%` : '';
  // Three short lines; no moves, so nothing is spoiled.
  const text =
    `**${label}**  \n` +
    `${pips} **${mine.best}/${foes}** pushed off${top}  \n` +
    `First try: ${mine.firstTry}/${foes} · best on ${mine.bestAt === 1 ? 'the first run' : `run ${mine.bestAt}`}`;
  // Always from the player's own account, as a reply to the post's one stickied
  // scores comment. Never from the app account.
  let comment;
  try {
    try {
      comment = await reddit.submitComment({ id: await scoreThread(postId), text, runAs: 'USER' });
    } catch (error) {
      // The scores comment may have been deleted: check it, replace it if so, try once more.
      console.warn('score comment failed, checking the scores comment', error);
      comment = await reddit.submitComment({ id: await scoreThread(postId, true), text, runAs: 'USER' });
    }
  } catch (error) {
    console.error('score comment failed', error);
    return fail(c, 'Couldn’t post your comment right now');
  }
  return c.json<ShareResponse>({ ok: true, commentUrl: comment?.permalink ? `https://reddit.com${comment.permalink}` : null });
});

api.post('/follow', async (c) => {
  const username = await reddit.getCurrentUsername();
  if (!username) return fail(c, 'Log in to follow', 401);
  try {
    return c.json<FollowResponse>({ ok: true, subscribed: await follow(username) });
  } catch (error) {
    console.error('follow failed', error);
    return fail(c, 'Couldn’t follow right now');
  }
});
