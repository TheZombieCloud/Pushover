import { redis } from '@devvit/web/server';
import type { IslandLink, LeaderboardRow, Mine, Puzzle, Standing } from '../../shared/api';
import { WEEKDAYS, dailyPoolLevel, playable, randomPoolLevel, tierOf } from '../../shared/pool';
import { MAX_POWER, isValidMove, runLevel } from '../../shared/sim';
import type { Level, Move, RunResult } from '../../shared/sim';
import { twistOf } from '../../shared/twist';
import { avatarOf } from './avatars';
import { DAY_MS, dailyNumber, isDailyId, todayId } from './days';

/*
 * Redis schema. Devvit Redis can't enumerate keys, so every key is derivable from the
 * puzzle id (YYYY-MM-DD for dailies, test-<ts> for tests), the post id, or the username.
 *
 *   puzzle:{pid}       hash    level (JSON Level), number, weekday, by
 *   post:{postId}      string  pid this post plays
 *   me:{pid}:{user}    hash    best, firstTry, runs, bestAt, bestMoves (JSON), star ('1' once earned)
 *   lb:{pid}           zset    user -> (SCORE_CAP - best) * 1e6 + bestAt   (ascending = best)
 *   first:{pid}        hash    score -> players whose first finished run scored that
 *   streak:{user}      hash    last (day id), count
 *   pushed:{user}      string  when this player last started a run on any island (ms)
 *   stars:{user}       string  how many islands' bonus stars this player has earned
 *
 * Player-made islands (pid = u-<time>-<random>, stored as a puzzle like any other):
 *
 *   islands            zset    postId -> when it was posted (newest listed first)
 *   island:{postId}    hash    url, by, foes, turns, twist
 *   made:{day}:{user}  string  islands this player has posted today
 *
 * When a post is deleted or removed, forgetPost drops what was stored for it.
 *
 * A "run" is one finished attempt: every turn played, or you fell, or no foes left.
 * Runs are replayed here with the shared simulation, so a score can't be made up.
 */

export { dailyNumber, todayId } from './days';

const SCORE_CAP = 100;
const RANK_STEP = 1e6;

const weekdayOf = (pid: string) => (isDailyId(pid) ? WEEKDAYS[tierOf(pid)]! : 'Wed');

export const savePuzzle = async (p: Puzzle): Promise<void> => {
  await redis.hSet(`puzzle:${p.id}`, {
    level: JSON.stringify(p.level),
    number: String(p.number),
    weekday: p.weekday,
    by: p.by ?? '',
  });
};

export const getPuzzle = async (pid: string): Promise<Puzzle> => {
  const stored = await redis.hGetAll(`puzzle:${pid}`);
  if (stored.level) {
    return {
      id: pid,
      number: isDailyId(pid) ? await dailyNumber(pid) : Number(stored.number ?? 0),
      weekday: stored.weekday || weekdayOf(pid),
      level: JSON.parse(stored.level) as Level,
      by: stored.by || null,
    };
  }
  // First time anyone asks for this day: take it from the pool and freeze it, so a
  // later pool rebuild can't change an island people already played.
  const puzzle: Puzzle = {
    id: pid,
    number: isDailyId(pid) ? await dailyNumber(pid) : 0,
    weekday: weekdayOf(pid),
    level: playable(dailyPoolLevel(isDailyId(pid) ? pid : todayId())),
    by: null,
  };
  await savePuzzle(puzzle);
  return puzzle;
};

export const randomTestPuzzle = (): Puzzle => {
  const l = randomPoolLevel(Math.random);
  return { id: `test-${Date.now()}`, number: 0, weekday: WEEKDAYS[l.tier]!, level: playable(l), by: null };
};

export const puzzleIdForPost = async (postId: string | undefined): Promise<string> => {
  if (postId) {
    const pid = await redis.get(`post:${postId}`);
    if (pid) return pid;
  }
  return todayId();
};

export const linkPost = async (postId: string, pid: string): Promise<void> => {
  await redis.set(`post:${postId}`, pid);
};

// ---- your record ----
const meKey = (pid: string, user: string) => `me:${pid}:${user}`;

export const getMine = async (pid: string, user: string): Promise<Mine | null> => {
  const h = await redis.hGetAll(meKey(pid, user));
  if (!h.runs) return null;
  return { best: Number(h.best), firstTry: Number(h.firstTry), runs: Number(h.runs), bestAt: Number(h.bestAt), ...(h.star === '1' ? { star: true } : {}) };
};

export const parseMoves = (raw: unknown, level: Level): Move[] | null => {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > level.turns) return null;
  if (!raw.every(isValidMove)) return null;
  return raw.map((m: Move) => ({ d: m.d, p: Math.min(MAX_POWER, m.p) }));
};

export type RecordOutcome =
  | { ok: true; result: RunResult; mine: Mine; improved: boolean; first: boolean; newStar: boolean }
  | { ok: false; error: string };

export const recordRun = async (puzzle: Puzzle, user: string, moves: Move[]): Promise<RecordOutcome> => {
  const result = runLevel(puzzle.level, moves);
  if (!result.complete) return { ok: false, error: 'That run isn’t finished yet' };
  if (result.turnsPlayed !== moves.length) return { ok: false, error: 'Extra moves after the run ended' };

  const prev = await getMine(puzzle.id, user);
  const runs = (prev?.runs ?? 0) + 1;
  const improved = !prev || result.score > prev.best;
  const mine: Mine = {
    best: improved ? result.score : prev.best,
    firstTry: prev ? prev.firstTry : result.score,
    runs,
    bestAt: improved ? runs : prev.bestAt,
    ...(prev?.star || result.star ? { star: true } : {}),
  };
  await redis.hSet(meKey(puzzle.id, user), {
    best: String(mine.best),
    firstTry: String(mine.firstTry),
    runs: String(mine.runs),
    bestAt: String(mine.bestAt),
    ...(mine.star ? { star: '1' } : {}),
    ...(improved ? { bestMoves: JSON.stringify(moves) } : {}),
  });
  if (improved) await redis.zAdd(`lb:${puzzle.id}`, { member: user, score: (SCORE_CAP - mine.best) * RANK_STEP + mine.bestAt });
  if (!prev) {
    await redis.hIncrBy(`first:${puzzle.id}`, String(result.score), 1);
    if (isDailyId(puzzle.id)) await bumpStreak(user, puzzle.id);
  }
  // Each island's star counts once toward the player's total.
  const newStar = !!mine.star && !prev?.star;
  if (newStar) await redis.incrBy(`stars:${user}`, 1);
  return { ok: true, result, mine, improved, first: !prev, newStar };
};

/** How many islands' bonus stars this player has earned. */
export const getStars = async (user: string): Promise<number> => Number((await redis.get(`stars:${user}`)) ?? 0) || 0;

/** The moves of your best run, to watch again. */
export const getBestMoves = async (pid: string, user: string): Promise<Move[] | null> => {
  const raw = await redis.hGet(meKey(pid, user), 'bestMoves');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isValidMove) ? parsed : null;
  } catch {
    return null;
  }
};

// ---- player-made islands ----
export const MADE_PER_DAY = 5;

const madeKey = (user: string) => `made:${todayId()}:${user}`;

export const madeToday = async (user: string): Promise<number> => Number((await redis.get(madeKey(user))) ?? 0);

/** Store a checked, player-made island as a puzzle of its own. */
export const createIsland = async (level: Level, by: string): Promise<Puzzle> => {
  const id = `u-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const puzzle: Puzzle = { id, number: 0, weekday: '', level, by };
  await savePuzzle(puzzle);
  await redis.incrBy(madeKey(by), 1);
  await redis.expire(madeKey(by), 2 * 24 * 60 * 60);
  return puzzle;
};

/** Add a posted island to the list shown on results sheets. */
export const listIsland = async (postId: string, puzzle: Puzzle, url: string): Promise<void> => {
  await redis.hSet(`island:${postId}`, {
    url,
    by: puzzle.by ?? '',
    foes: String(puzzle.level.foes.length),
    turns: String(puzzle.level.turns),
    twist: twistOf(puzzle.level)?.name ?? '',
  });
  await redis.zAdd('islands', { member: postId, score: Date.now() });
};

/** The newest player-made islands, leaving out the post being viewed. */
export const latestIslands = async (exceptPostId: string | undefined, count = 3): Promise<IslandLink[]> => {
  const rows = await redis.zRange('islands', 0, count, { by: 'rank', reverse: true });
  const links: IslandLink[] = [];
  for (const row of rows) {
    if (row.member === exceptPostId || links.length >= count) continue;
    const h = await redis.hGetAll(`island:${row.member}`);
    if (!h.url || !h.by) continue;
    links.push({ url: h.url, by: h.by, foes: Number(h.foes ?? 0), turns: Number(h.turns ?? 0), twist: h.twist || null });
  }
  return links;
};

/**
 * A post was deleted or removed: drop what is stored for it. A player-made island is
 * that player's content, so the island, its leaderboard and every run on it go too.
 * Daily and test islands are the app's own and keep their records.
 */
export const forgetPost = async (postId: string): Promise<void> => {
  const pid = await redis.get(`post:${postId}`);
  await redis.zRem('islands', [postId]);
  await redis.del(`island:${postId}`, `sticky:${postId}`);
  if (!pid || !pid.startsWith('u-')) return;
  const players = await redis.zRange(`lb:${pid}`, 0, -1, { by: 'rank' });
  for (const p of players) await redis.del(meKey(pid, p.member));
  await redis.del(`puzzle:${pid}`, `lb:${pid}`, `first:${pid}`, `stats:${pid}`, `post:${postId}`);
};

/** Testing aid for mods: forget a user's record on a puzzle. */
export const resetMine = async (pid: string, user: string): Promise<boolean> => {
  const mine = await getMine(pid, user);
  if (!mine) return false;
  await redis.zRem(`lb:${pid}`, [user]);
  await redis.hIncrBy(`first:${pid}`, String(mine.firstTry), -1);
  await redis.del(meKey(pid, user));
  return true;
};

// ---- newcomers ----
// The hand and the first-turn preview are for someone's very first push, on whichever
// post that is, and again for someone who has not played for LAPSE_DAYS. Players from
// before this was recorded are placed by their streak's last day, or a run on this island.
const LAPSE_DAYS = 30;

export const isNewcomer = async (user: string, mine: Mine | null): Promise<boolean> => {
  const [pushed, last] = await Promise.all([redis.get(`pushed:${user}`), redis.hGet(`streak:${user}`, 'last')]);
  const seen = Math.max(Number(pushed) || 0, (last && Date.parse(last)) || 0);
  if (seen > 0) return Date.now() - seen > LAPSE_DAYS * DAY_MS;
  return !mine;
};

export const markPushed = async (user: string): Promise<void> => {
  await redis.set(`pushed:${user}`, String(Date.now()));
};

// ---- streaks ----
// A daily counts toward your streak only when you finish a run on its own day.
const bumpStreak = async (user: string, pid: string) => {
  if (todayId() !== pid) return;
  const s = await redis.hGetAll(`streak:${user}`);
  if (s.last && s.last >= pid) return;
  const yesterday = todayId(Date.parse(pid) - DAY_MS);
  const count = s.last === yesterday ? Number(s.count ?? 0) + 1 : 1;
  await redis.hSet(`streak:${user}`, { last: pid, count: String(count) });
};

export const getStreak = async (user: string): Promise<number> => {
  const s = await redis.hGetAll(`streak:${user}`);
  if (!s.last) return 0;
  const today = todayId();
  const yesterday = todayId(Date.now() - DAY_MS);
  return s.last === today || s.last === yesterday ? Number(s.count ?? 0) : 0;
};

// ---- leaderboard & standing ----
const decode = (score: number) => ({ score: SCORE_CAP - Math.floor(score / RANK_STEP), bestAt: score % RANK_STEP });

export const playerCount = (pid: string) => redis.zCard(`lb:${pid}`);

export const leaderboard = async (pid: string, start: number, stop: number): Promise<LeaderboardRow[]> => {
  const rows = await redis.zRange(`lb:${pid}`, start, stop, { by: 'rank' });
  return Promise.all(
    rows.map(async (r, i) => ({ rank: start + i + 1, username: r.member, ...decode(r.score), avatar: await avatarOf(r.member) }))
  );
};

export const myRow = async (pid: string, user: string): Promise<LeaderboardRow | null> => {
  const [rank, score] = await Promise.all([redis.zRank(`lb:${pid}`, user), redis.zScore(`lb:${pid}`, user)]);
  if (rank === undefined || score === undefined) return null;
  return { rank: rank + 1, username: user, ...decode(score), avatar: await avatarOf(user) };
};

export const standing = async (puzzle: Puzzle, user: string, mine: Mine): Promise<Standing> => {
  const [me, players, firstRaw, top] = await Promise.all([
    myRow(puzzle.id, user),
    playerCount(puzzle.id),
    redis.hGetAll(`first:${puzzle.id}`),
    leaderboard(puzzle.id, 0, 2),
  ]);
  const rank = me?.rank ?? null;
  const rival = rank && rank > 1 ? ((await leaderboard(puzzle.id, rank - 2, rank - 2))[0] ?? null) : null;
  const firstTries = Array.from({ length: puzzle.level.foes.length + 1 }, (_, s) => Math.max(0, Number(firstRaw[String(s)] ?? 0)));
  return { mine, rank, players, firstTries, top, rival };
};
