import type { Level, Move, RunResult } from './sim.ts';

/** One playable island: a daily (id = YYYY-MM-DD), a test, or later a player-made one. */
export type Puzzle = {
  id: string;
  /** Daily number in this community (0 for tests and player levels). */
  number: number;
  /** "Mon" … "Sun": sets the difficulty tier for dailies. */
  weekday: string;
  level: Level;
  /** Maker's username for player-made islands. */
  by: string | null;
};

/** Your record on one island. A "run" is a finished attempt (all turns played, or you fell). */
export type Mine = {
  best: number;
  /** Score of your very first finished run. */
  firstTry: number;
  runs: number;
  /** Runs it took to reach your best. */
  bestAt: number;
};

export type LeaderboardRow = {
  rank: number;
  username: string;
  score: number;
  bestAt: number;
  avatar: string | null;
};

export type Standing = {
  mine: Mine;
  rank: number | null;
  players: number;
  /** First-try scores: index = foes pushed off, value = players. */
  firstTries: number[];
  top: LeaderboardRow[];
  /** The player one place above you. */
  rival: LeaderboardRow | null;
};

export type InitResponse = {
  username: string | null;
  puzzle: Puzzle;
  streak: number;
  players: number;
  best: LeaderboardRow | null;
  standing: Standing | null;
  subreddit: string;
  following: boolean;
};

export type RunRequest = { moves: Move[] };
export type RunResponse = { result: RunResult; standing: Standing; streak: number; improved: boolean };
export type TurnRequest = { moves: Move[] };
export type LeaderboardResponse = { rows: LeaderboardRow[]; you: LeaderboardRow | null };
export type ShareResponse = { ok: true; commentUrl: string | null };
export type FollowResponse = { ok: true; subscribed: boolean };
export type ErrorResponse = { status: 'error'; message: string };

/** Your best run on this island, to watch again. */
export type ReplayResponse = { moves: Move[] | null };

/** A player-made island being posted: the level, and the maker's own winning line. */
export type MakeRequest = { level: unknown; solution: unknown };
export type MakeResponse = { ok: true; url: string };

/** A link to a player-made island's post. */
export type IslandLink = { url: string; by: string; foes: number; turns: number; twist: string | null };
export type IslandsResponse = { islands: IslandLink[] };
