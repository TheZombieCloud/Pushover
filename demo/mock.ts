/*
 * Local demo backend for recordings and screenshots. Patches window.fetch so the real
 * client talks to an in-memory game instead of Devvit. Runs and player-made islands
 * are checked with the same shared code as the server; other players are made up.
 *
 *   ?s=fresh     first visit (title card)            ?day=Mon..Sun picks the tier
 *   ?s=played    already played (results sheet)      ?auto=[moves] autoplays a run
 *   ?week=N      a later island from the same weekday tier
 */
import type { InitResponse, IslandLink, LeaderboardRow, Mine, Puzzle, Standing } from '../src/shared/api';
import { WEEKDAYS, dailyPoolLevel, playable } from '../src/shared/pool';
import type { PoolLevel } from '../src/shared/pool';
import { AIM_MOVES, STAY, createState, isGround, isValidMove, playTurn, runLevel } from '../src/shared/sim';
import type { FoeKind, Level, Move, Rock, Spot } from '../src/shared/sim';
import { solve } from '../src/shared/solve';
import { twistOf } from '../src/shared/twist';
import { checkLevel } from '../src/shared/validate';

const LATENCY_MS = 200;
const q = new URLSearchParams(location.search);
const scenario = q.get('s') ?? 'fresh';

/** A real date on the requested weekday, so the tier matches. */
const dayId = (() => {
  const want = WEEKDAYS.indexOf((q.get('day') ?? 'Wed') as (typeof WEEKDAYS)[number]);
  const d = new Date(Date.UTC(2026, 10, 16)); // a Monday
  d.setUTCDate(d.getUTCDate() + Math.max(0, want) + 7 * Number(q.get('week') ?? 0));
  return d.toISOString().slice(0, 10);
})();

const pool: PoolLevel = dailyPoolLevel(dayId);
const puzzle: Puzzle = { id: dayId, number: 12, weekday: WEEKDAYS[(new Date(dayId).getUTCDay() + 6) % 7]!, level: playable(pool), by: null };
const foes = puzzle.level.foes.length;

// Make-believe crowd: first-try scores skew low; a few got everything.
const PLAYERS = 1284;
const firstTries = Array.from({ length: foes + 1 }, (_, s) => Math.round(PLAYERS * [0.3, 0.26, 0.2, 0.12, 0.07, 0.03, 0.02][s]! || 6));
const NAMES = ['moss_wrangler', 'jellybean_jo', 'cliffhanger42', 'gloopy', 'sunset_sam', 'puddle_duck', 'tumbleweed', 'okra_okay'];

// "Already played": the solver's line with its last move swapped for standing still.
const earlier: Move[] = Array.from({ length: puzzle.level.turns }, (_, i) => (i < pool.solution.length - 1 ? pool.solution[i]! : STAY));
const earlierScore = runLevel(puzzle.level, earlier).score;

let mine: Mine | null = scenario === 'played' ? { best: earlierScore, firstTry: Math.max(0, earlierScore - 1), runs: 3, bestAt: 2 } : null;
let bestMoves: Move[] | null = scenario === 'played' ? earlier : null;
let streak = scenario === 'played' ? 4 : 3;

// Islands "other players" made, plus any posted in this session.
const islands: IslandLink[] = [
  { url: 'https://www.reddit.com/r/PushoverGame/comments/demo1', by: 'cliffhanger42', foes: 4, turns: 3, twist: 'Boulders' },
  { url: 'https://www.reddit.com/r/PushoverGame/comments/demo2', by: 'gloopy', foes: 3, turns: 2, twist: null },
];

const top = (): LeaderboardRow[] =>
  NAMES.map((username, i) => ({ rank: i + 1, username, score: Math.max(0, foes - Math.floor(i / 3)), bestAt: 1 + (i % 4), avatar: null }));

const rankOf = (m: Mine) => {
  const better = top().filter((r) => r.score > m.best || (r.score === m.best && r.bestAt < m.bestAt)).length;
  return better + 1 + (m.best < foes ? 300 - m.best * 60 : 0);
};

const standing = (): Standing | null => {
  if (!mine) return null;
  const rank = rankOf(mine);
  const rows = top();
  return {
    mine,
    rank,
    players: PLAYERS + 1,
    firstTries,
    top: rows.slice(0, 3),
    rival: rank > 1 ? (rows[Math.min(rows.length - 1, rank - 2)] ?? null) : null,
  };
};

const init = (): InitResponse => ({
  username: 'you',
  puzzle,
  streak,
  players: PLAYERS,
  best: top()[0]!,
  standing: standing(),
  subreddit: 'PushoverGame',
  following: false,
  newcomer: scenario === 'fresh' && !mine,
});

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const err = (message: string): Reply => ({ status: 400, body: { status: 'error', message } });

const handle = (path: string, body: Record<string, unknown>): Reply => {
  const [name] = path.split('?');
  if (name?.startsWith('telemetry/')) return ok({ journeyId: 'demo', receipt: { status: 'OK' } });
  switch (name) {
    case 'init':
      return ok(init());
    case 'turn':
      return ok({ ok: true });
    case 'run': {
      const raw = body.moves;
      if (!Array.isArray(raw) || !raw.every(isValidMove)) return err('Bad moves');
      const moves: Move[] = raw;
      const result = runLevel(puzzle.level, moves);
      if (!result.complete) return err('That run isn’t finished');
      const prev = mine;
      const runs = (prev?.runs ?? 0) + 1;
      const improved = !prev || result.score > prev.best;
      mine = {
        best: improved ? result.score : prev.best,
        firstTry: prev ? prev.firstTry : result.score,
        runs,
        bestAt: improved ? runs : prev.bestAt,
      };
      if (improved) bestMoves = moves;
      if (!prev) {
        streak++;
        firstTries[result.score] = (firstTries[result.score] ?? 0) + 1;
      }
      return ok({ result, standing: standing(), streak, improved });
    }
    case 'replay':
      return ok({ moves: bestMoves });
    case 'levels': {
      const checked = checkLevel(body.level, body.solution);
      if (!checked.ok) return err(checked.error);
      islands.unshift({
        url: `https://www.reddit.com/r/PushoverGame/comments/demo${islands.length + 1}`,
        by: 'you',
        foes: checked.level.foes.length,
        turns: checked.level.turns,
        twist: twistOf(checked.level)?.name ?? null,
      });
      Object.assign(window, { __posted: checked.level });
      return ok({ ok: true, url: islands[0]!.url });
    }
    case 'islands':
      return ok({ islands: islands.slice(0, 3) });
    case 'leaderboard': {
      const s = standing();
      return ok({ rows: top(), you: s && s.rank ? { rank: s.rank, username: 'you', score: s.mine.best, bestAt: s.mine.bestAt, avatar: null } : null });
    }
    case 'share':
      return ok({ ok: true, commentUrl: null });
    case 'follow':
      return ok({ ok: true, subscribed: true });
  }
  return err(`Unknown endpoint ${name}`);
};

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const at = url.indexOf('/api/');
  if (at < 0) return realFetch(input, init);
  const raw = typeof init?.body === 'string' ? init.body : '{}';
  const parsed: unknown = JSON.parse(raw);
  const body: Record<string, unknown> = typeof parsed === 'object' && parsed !== null ? { ...parsed } : {};
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  const reply = handle(url.slice(at + 5), body);
  return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
};

// Devvit toasts drawn as an overlay, since there's no Reddit around the post.
window.addEventListener('message', (e: MessageEvent<unknown>) => {
  const d = e.data;
  if (typeof d !== 'object' || d === null || !('showToast' in d)) return;
  const st = d.showToast;
  const text =
    typeof st === 'object' && st !== null && 'toast' in st && typeof st.toast === 'object' && st.toast !== null && 'text' in st.toast
      ? String(st.toast.text)
      : '';
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'demo-toast';
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
});

/** The editor's draft island, as the client publishes it. */
type Draft = { shape: string[]; you: Spot; foes: (Spot & { kind: FoeKind })[]; rocks: Rock[]; ice: boolean; turns: number };

/** For the recorder driving the editor: a good line through the draft island. */
const solveDraft = (draft: Draft): { moves: Move[]; outs: number } => {
  const level: Level = {
    shape: draft.shape,
    you: draft.you,
    foes: draft.foes,
    turns: draft.turns,
    par: 0,
    ...(draft.rocks.length ? { rocks: draft.rocks } : {}),
    ...(draft.ice ? { ice: true } : {}),
  };
  // The maker may not fall in their own run, so take the best line that stays on the
  // island; failing that, the best line cut short just before the fall.
  const lines = [solve(level), solve(level, 32, 1), solve(level, 8, 3)].map((s) => s.moves);
  for (const moves of [...lines]) {
    for (let cut = moves.length - 1; cut >= 0; cut--) lines.push(moves.map((m, i) => (i < cut ? m : STAY)));
  }
  let best: { moves: Move[]; outs: number } = { moves: [], outs: 0 };
  for (const moves of lines) {
    const r = runLevel(level, moves);
    if (!r.fell && r.score > best.outs) best = { moves, outs: r.score };
  }
  return best;
};

/** For the recorder: a first move that ends with you down a hole in the island, if it has one. */
const holeMove = ((): Move | null => {
  const { level } = puzzle;
  const grass = (x: number, y: number) => isGround(level.shape, x, y);
  for (const m of AIM_MOVES) {
    const fall = playTurn(createState(level), level, 0, m).find((e) => e.kind === 'fall' && e.who === 0);
    if (!fall || fall.kind !== 'fall') continue;
    // A hole has grass on every side of where you went down.
    let sides = 0;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      for (let d = 4; d < 176; d += 4)
        if (grass(fall.x + dx * d, fall.y + dy * d)) {
          sides++;
          break;
        }
    }
    if (sides === 4) return m;
  }
  return null;
})();

/** For the recorder: a strong first push that takes you off the island. */
const fallMove: Move = [...AIM_MOVES].reverse().find((m) => runLevel(puzzle.level, [m]).fell) ?? STAY;

// For the recorder: today's stored solution, so it can autoplay a strong run.
Object.assign(window, { __demo: { solution: Array.from({ length: pool.turns }, (_, i) => pool.solution[i] ?? STAY), par: pool.par, foes, turns: pool.turns, kinds: new Set(puzzle.level.foes.map((f) => f.kind)).size, solveDraft, holeMove, fallMove } });
