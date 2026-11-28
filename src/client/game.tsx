import './fonts';
import './index.css';

import { navigateTo, showToast } from '@devvit/web/client';
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  FollowResponse,
  InitResponse,
  IslandLink,
  IslandsResponse,
  LeaderboardResponse,
  LeaderboardRow,
  MakeResponse,
  ReplayResponse,
  RunResponse,
  ShareResponse,
  Standing,
} from '../shared/api';
import type { Level, Move, RunResult } from '../shared/sim';
import { STAR_GOALS } from '../shared/sim';
import { twistOf } from '../shared/twist';
import { checkLevel } from '../shared/validate';
import { call } from './api';
import { Build } from './build';
import { draftLevel, starter } from './draft';
import type { Draft } from './draft';
import { appReady, interact, journeyEnded, journeyHeaders, startJourney } from './journey';
import { Play } from './play';
import { sfx, unlockAudio } from './sound';
import { fmtCountdown, msToNextIsland, useNow } from './time';
import { foePip, icon, iconSize } from './uiart';
import { dayName, scoreLine } from './words';

/*
 * title   the island with its title card
 * play    a run
 * results the results sheet
 * watch   your best run, played back
 * build   the editor: shape the island, place slimes and boulders
 * author  the editor: play your island through, to prove it can be beaten
 * post    the editor: your run is done; post the island or change it
 */
type Screen = 'title' | 'play' | 'results' | 'watch' | 'build' | 'author' | 'post';

/** An island that has been played through in the editor and is ready to post. */
type Made = { level: Level; solution: Move[]; result: RunResult; problem: string | null };

/** One slime per foe; the first `out` of them knocked out. */
const Pips = ({ total, out }: { total: number; out: number }) => (
  <div className="pips" aria-hidden="true">
    {Array.from({ length: total }, (_, i) => (
      <img key={i} className="px" src={foePip(i, i < out)} alt="" />
    ))}
  </div>
);

const FirstTries = ({ counts, mine, foes }: { counts: number[]; mine: number; foes: number }) => {
  const max = Math.max(1, ...counts);
  return (
    <div className="dist" aria-label="First-try scores of everyone who played">
      <p className="dist-title">Everyone’s first try</p>
      {Array.from({ length: foes + 1 }, (_, s) => {
        const n = counts[s] ?? 0;
        return (
          <div key={s} className={`dist-row ${s === mine ? 'me' : ''}`}>
            <span className="dist-k">{s}</span>
            <span className="dist-bar" style={{ width: `${Math.max(12, (n / max) * 88)}%` }}>
              {n > 0 ? n.toLocaleString() : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** Their own avatar, else one of the game's slimes (always the same one for a given name). */
const Avatar = ({ name, url }: { name: string; url: string | null }) => {
  const [broken, setBroken] = useState(false);
  const slime = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return url && !broken ? (
    <img className="lb-av snoo" src={url} alt="" onError={() => setBroken(true)} />
  ) : (
    <img className="lb-av pip" src={foePip(slime, false)} alt="" />
  );
};

const Leaderboard = ({ onClose }: { onClose: () => void }) => {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  useEffect(() => {
    call<LeaderboardResponse>('leaderboard').then(setData, () => setData({ rows: [], you: null }));
  }, []);
  const [cw, ch] = iconSize('close');
  const row = (r: LeaderboardRow, me = false) => (
    <li key={`${r.rank}-${r.username}`} className={me ? 'me' : ''}>
      <span className="lb-rank">{r.rank}</span>
      <Avatar name={r.username} url={r.avatar} />
      <span className="lb-name">u/{r.username}</span>
      <span className="lb-score">{r.score}</span>
      <span className="lb-runs">{r.bestAt === 1 ? '1st try' : `try ${r.bestAt}`}</span>
    </li>
  );
  return (
    <div className="nine panel sheet">
      <div className="sheet-head">
        <h2 className="headline">Leaderboard</h2>
        <button className="nine btn square" onClick={onClose} aria-label="Close">
          <img className="px" src={icon('close')} alt="" style={{ width: `calc(${cw} * var(--px))`, height: `calc(${ch} * var(--px))` }} />
        </button>
      </div>
      {!data ? (
        <p className="soft">Loading…</p>
      ) : data.rows.length === 0 ? (
        <p className="soft">Nobody yet. Be the first.</p>
      ) : (
        <ol className="lb-list">
          {data.rows.map((r) => row(r, r.username === data.you?.username))}
          {data.you && !data.rows.some((r) => r.username === data.you?.username) && row(data.you, true)}
        </ol>
      )}
      <p className="soft">Most slimes pushed off, then fewest tries to get there.</p>
    </div>
  );
};

/** Islands other players made, each a tap away, and the way in to making your own. */
const Islands = ({ onBuild }: { onBuild: () => void }) => {
  const [islands, setIslands] = useState<IslandLink[]>([]);
  useEffect(() => {
    call<IslandsResponse>('islands').then((r) => setIslands(r.islands), () => setIslands([]));
  }, []);
  return (
    <div className="islands">
      <p className="dist-title">Islands by players</p>
      {islands.map((i) => (
        <button key={i.url} className="island-link" onClick={() => navigateTo(i.url)}>
          <span>by u/{i.by}</span>
          <span>
            {i.foes} foes · {i.turns} turns{i.twist ? ` · ${i.twist}` : ''}
          </span>
        </button>
      ))}
      <button
        className="nine btn grass"
        onClick={() => {
          interact('build');
          onBuild();
        }}
      >
        Build your own island
      </button>
    </div>
  );
};

const Results = ({
  init,
  standing,
  last,
  streak,
  stars,
  onAgain,
  onWatch,
  onBuild,
}: {
  init: InitResponse;
  standing: Standing;
  last: RunResult | null;
  streak: number;
  /** Bonus stars earned in all. */
  stars: number;
  onAgain: () => void;
  onWatch: () => void;
  onBuild: () => void;
}) => {
  const { puzzle } = init;
  const foes = puzzle.level.foes.length;
  const now = useNow(30_000);
  const [board, setBoard] = useState(false);
  const [shared, setShared] = useState(false);
  const [following, setFollowing] = useState(init.following);
  const { mine } = standing;
  const perfect = mine.best === foes;
  const shown = last ?? { score: mine.best, outs: mine.best, fell: false, turnsPlayed: 0, complete: true };

  const share = async () => {
    interact('share');
    try {
      await call<ShareResponse>('share', {});
      setShared(true);
      showToast({ text: 'Commented from your account', appearance: 'success' });
    } catch (e) {
      showToast((e as Error).message);
    }
  };
  const follow = async () => {
    interact('follow');
    try {
      const r = await call<FollowResponse>('follow', {});
      if (r.subscribed) setFollowing(true);
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  if (board) return <Leaderboard onClose={() => setBoard(false)} />;

  return (
    <div className="nine panel sheet">
      <p className="kicker">{last ? (shown.score === foes ? 'Clean sweep' : shown.fell ? 'You fell off' : 'Run over') : 'Your best so far'}</p>
      <h2 className="headline">{scoreLine(shown.score, foes)}</h2>
      <Pips total={foes} out={shown.score} />
      {puzzle.level.star && (
        <p className={`star-goal ${mine.star ? 'got' : ''}`}>
          <span className="star-icon" aria-hidden="true" />
          {mine.star ? 'Bonus star: ' : 'Bonus: '}
          {STAR_GOALS[puzzle.level.star]}
        </p>
      )}
      <div className="stats">
        <div>
          <b>{mine.best}</b>
          <span>best</span>
        </div>
        <div>
          <b>{foes}</b>
          <span>max</span>
        </div>
        <div>
          <b>{mine.firstTry}</b>
          <span>1st try</span>
        </div>
        <div>
          <b>{mine.runs}</b>
          <span>{mine.runs === 1 ? 'run' : 'runs'}</span>
        </div>
      </div>
      <p className="center-text">
        {standing.rank ? (
          <>
            #{standing.rank.toLocaleString()} of {standing.players.toLocaleString()}
            {standing.rival && ` · behind u/${standing.rival.username}`}
          </>
        ) : (
          'Not ranked yet'
        )}
        {((streak > 0 && puzzle.number > 0) || stars > 0) && <br />}
        {streak > 0 && puzzle.number > 0 && `${streak}-day streak`}
        {streak > 0 && puzzle.number > 0 && stars > 0 && ' · '}
        {stars > 0 && (
          <span className="star-total">
            <span className="star-icon got" aria-hidden="true" />
            {stars} {stars === 1 ? 'star' : 'stars'}
          </span>
        )}
      </p>

      <button className={`nine btn big ${perfect ? 'wood-big' : 'gold'}`} onClick={onAgain}>
        {perfect ? 'Play again' : 'Try again'}
        {!perfect && <span className="sub">Go for all {foes}</span>}
      </button>
      <div className="row">
        <button
          className="nine btn wide"
          onClick={() => {
            interact('leaderboard');
            setBoard(true);
          }}
        >
          Leaders
        </button>
        <button
          className="nine btn wide"
          onClick={() => {
            interact('replay');
            onWatch();
          }}
        >
          Replay
        </button>
      </div>

      <button className="nine btn stack" onClick={share} disabled={shared}>
        {shared ? 'Score commented' : 'Comment my score'}
        {!shared && <span className="sub">from your account, in the scores thread</span>}
      </button>

      <FirstTries counts={standing.firstTries} mine={mine.firstTry} foes={foes} />
      <Islands onBuild={onBuild} />

      {!following && init.subreddit && (
        <button className="nine btn" onClick={follow}>
          Follow r/{init.subreddit}
        </button>
      )}
      {puzzle.number > 0 && <p className="soft">Next island in {fmtCountdown(msToNextIsland(now))}</p>}
    </div>
  );
};

const Title = ({ init, onStart }: { init: InitResponse; onStart: () => void }) => {
  const { puzzle, players, best } = init;
  const foes = puzzle.level.foes.length;
  const twist = twistOf(puzzle.level);
  return (
    <>
      <div className="splash-top">
        <h1 className="logo">Pushover</h1>
        <p className="outlined">
          {puzzle.by
            ? `Island by u/${puzzle.by}`
            : puzzle.number > 0
              ? `No. ${puzzle.number} · ${dayName(puzzle.weekday)}${twist ? ` · ${twist.name}` : ''}`
              : 'Test island'}
        </p>
      </div>
      <div className="nine panel sheet">
        <p className="goal">
          Push <b>{foes} slimes</b> off the island in <b>{puzzle.level.turns} turns</b>.
        </p>
        {twist && <p className="twist">{twist.rule}</p>}
        {puzzle.level.star && (
          <p className="star-goal">
            <span className="star-icon" aria-hidden="true" />
            Bonus: {STAR_GOALS[puzzle.level.star]}
          </p>
        )}
        <p className="soft">
          Fall off yourself and your run ends there.
          <br />
          {players > 0 ? `${players.toLocaleString()} played` : 'Be the first to play'}
          {best ? ` · best ${best.score}/${foes}` : ''}
        </p>
        <button className="nine btn gold big" onClick={onStart}>
          Play
        </button>
      </div>
    </>
  );
};

/** The editor's last step: you played your island through; post it, or change it. */
const PostSheet = ({
  made,
  by,
  posting,
  onPost,
  onMoves,
  onIsland,
}: {
  made: Made;
  by: string | null;
  posting: boolean;
  onPost: () => void;
  onMoves: () => void;
  onIsland: () => void;
}) => {
  const foes = made.level.foes.length;
  return (
    <div className="nine panel sheet">
      <p className="kicker">{made.problem ? 'Not ready yet' : 'Ready to post'}</p>
      <h2 className="headline">{made.result.fell ? 'You fell off' : scoreLine(made.result.score, foes)}</h2>
      <Pips total={foes} out={made.result.score} />
      <p className="center-text">{made.problem ?? `Players will try to push all ${foes} off.`}</p>
      {!made.problem && (
        <button className="nine btn gold big" onClick={onPost} disabled={posting}>
          {posting ? 'Posting…' : 'Post island'}
          <span className="sub">a new post from your account{by ? ` (u/${by})` : ''}</span>
        </button>
      )}
      <div className="row">
        <button className="nine btn wide" onClick={onMoves}>
          Play again
        </button>
        <button className="nine btn wide" onClick={onIsland}>
          Change island
        </button>
      </div>
    </div>
  );
};

export const App = () => {
  const [init, setInit] = useState<InitResponse | null>(null);
  /** Set once a push has been made in this visit: the first-turn preview is not shown again. */
  const [pushed, setPushed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('title');
  const [standing, setStanding] = useState<Standing | null>(null);
  const [last, setLast] = useState<RunResult | null>(null);
  const [streak, setStreak] = useState(0);
  const [stars, setStars] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [replay, setReplay] = useState<Move[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  const [posting, setPosting] = useState(false);
  const auto = new URLSearchParams(location.search).get('auto');
  const autoplay: Move[] | null = auto ? (JSON.parse(auto) as Move[]) : null;

  useEffect(() => {
    call<InitResponse>('init').then(
      (d) => {
        setInit(d);
        setStanding(d.standing);
        setStreak(d.streak);
        setStars(d.stars);
        if (d.standing && !autoplay) setScreen('results');
        appReady();
      },
      (e: Error) => setError(e.message)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sound may only start after a tap. Every tap on a button also clicks.
  useEffect(() => {
    const onDown = (e: Event) => {
      unlockAudio();
      if (e.target instanceof Element && e.target.closest('button')) sfx.click();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, []);

  const foes = init?.puzzle.level.foes.length ?? 0;

  const onRunDone = useCallback(
    async (moves: Move[], result: RunResult) => {
      setLast(result);
      try {
        const r = await call<RunResponse>('run', { moves }, journeyHeaders());
        journeyEnded();
        setStanding(r.standing);
        setStreak(r.streak);
        setStars(r.stars);
      } catch (e) {
        showToast((e as Error).message);
      }
      window.setTimeout(() => {
        if (!result.fell) (result.score === foes ? sfx.sweep : sfx.done)();
        setScreen('results');
      }, 500);
    },
    [foes]
  );

  const onTurn = useCallback((moves: Move[]) => {
    void call('turn', { moves }, journeyHeaders()).catch(() => undefined);
  }, []);

  const onEvent = useCallback(() => {
    void startJourney();
    setPushed(true);
  }, []);

  // The editor: the island as it stands.
  const authorLevel = useMemo(() => (draft ? draftLevel(draft) : null), [draft]);
  // Only in the local demo: let the recorder see the draft so it can drive the editor.
  useEffect(() => {
    if ('__demo' in window) Object.assign(window, { __draft: draft });
  }, [draft]);

  /** You played your island through: build the finished level and check it can be posted. */
  const onAuthored = useCallback(
    (moves: Move[], result: RunResult) => {
      if (!draft) return;
      const level = draftLevel(draft);
      const checked = checkLevel(level, moves);
      setMade({
        level: checked.ok ? checked.level : level,
        solution: moves,
        result,
        problem: checked.ok ? null : checked.error,
      });
      window.setTimeout(() => setScreen('post'), 400);
    },
    [draft]
  );

  if (error) return <div className="screen-msg">{error}</div>;
  if (!init) return <div className="screen-msg">Loading island…</div>;

  const restart = (next: Screen) => {
    setRunKey((k) => k + 1);
    setScreen(next);
  };

  const again = () => {
    interact('restart');
    setLast(null);
    restart('play');
  };

  const watch = async () => {
    try {
      const r = await call<ReplayResponse>('replay');
      if (!r.moves) {
        showToast('No run to replay yet');
        return;
      }
      setReplay(r.moves);
      restart('watch');
    } catch (e) {
      showToast((e as Error).message);
    }
  };

  const build = () => {
    if (!init.username) {
      showToast('Log in to build an island');
      return;
    }
    if (!draft) setDraft(starter(Math.floor(Math.random() * 1e9)));
    setScreen('build');
  };

  const post = async () => {
    if (!made || made.problem) return;
    setPosting(true);
    let url: string | null = null;
    try {
      url = (await call<MakeResponse>('levels', { level: made.level, solution: made.solution })).url;
    } catch (e) {
      showToast((e as Error).message);
    }
    setPosting(false);
    if (!url) return;
    // Posted. Leave the editor, then go to the new post. If the jump doesn't happen,
    // the player is back on their results, where the new island is listed.
    showToast({ text: 'Island posted', appearance: 'success' });
    setDraft(null);
    setMade(null);
    setScreen(standing ? 'results' : 'title');
    try {
      navigateTo(url);
    } catch (e) {
      console.warn('could not open the new post', e);
    }
  };

  if (screen === 'build' && draft) {
    return <Build draft={draft} onChange={setDraft} onNext={() => restart('author')} onClose={() => setScreen(standing ? 'results' : 'title')} />;
  }

  if ((screen === 'author' || screen === 'post') && authorLevel) {
    return (
      <Play key={`author-${runKey}`} level={authorLevel} onDone={onAuthored} onClose={() => setScreen('build')} active={screen === 'author'}>
        {screen === 'post' && made && (
          <div className="overlay">
            <PostSheet made={made} by={init.username} posting={posting} onPost={post} onMoves={() => restart('author')} onIsland={() => setScreen('build')} />
          </div>
        )}
      </Play>
    );
  }

  if (screen === 'watch' && replay) {
    return (
      <Play
        key={`watch-${runKey}`}
        level={init.puzzle.level}
        mode="watch"
        script={replay}
        onDone={() => window.setTimeout(() => setScreen('results'), 900)}
        onClose={() => setScreen('results')}
        active
      />
    );
  }

  return (
    <Play
      key={runKey}
      level={init.puzzle.level}
      onDone={onRunDone}
      onTurn={onTurn}
      onEvent={onEvent}
      preview={init.newcomer && !pushed}
      active={screen === 'play'}
      script={screen === 'play' ? autoplay : null}
    >
      {screen === 'title' && (
        <div className="overlay title">
          <Title
            init={init}
            onStart={() => {
              if (!init.username) {
                showToast('Log in to play');
                return;
              }
              setScreen('play');
            }}
          />
        </div>
      )}
      {screen === 'results' && standing && (
        <div className="overlay">
          <Results init={init} standing={standing} last={last} streak={streak} stars={stars} onAgain={again} onWatch={watch} onBuild={build} />
        </div>
      )}
    </Play>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
