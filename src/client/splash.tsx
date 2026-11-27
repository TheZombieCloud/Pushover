import './fonts';
import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse } from '../shared/api';
import { DIR } from '../shared/dirs';
import { STAY, cloneState, createState, isMoving, launch, movesAt, reaches, step } from '../shared/sim';
import type { Move, Spot } from '../shared/sim';
import { call } from './api';
import { showPush } from './guide';
import { Scene } from './scene';
import type { Layout } from './scene';
import { fmtCountdown, msToNextIsland, useNow } from './time';
import { useViewport } from './uiart';
import { dayName } from './words';

const FRAME_MS = 1000 / 60;
// The card's loop, in frames: the hand drags the aim out, a beat, everyone goes
// (simulation ticks per frame), and a pause on the result before it starts over.
const DRAG_FROM = 30;
const DRAG_TO = 95;
const GO_AT = 130;
const WINDUP = 16;
const TICKS_PER_FRAME = 0.5;
const REST = 110;

// Inline feed card: today's island, live. The card plays one push over and over
// (unless reduced motion is asked for): the hand aims, everyone moves at once, a slime goes over the edge.
// One fetch, no game logic beyond the shared simulation.
export const Splash = () => {
  const [data, setData] = useState<InitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const scene = useRef<Scene | null>(null);
  const now = useNow(30_000);
  const vp = useViewport(240);
  const layout: Layout = useMemo(
    () => ({ w: vp.w, h: vp.h, boardY: Math.max(26, Math.round((vp.h - 252) * 0.5)), horizon: vp.h - 34 }),
    [vp]
  );

  useEffect(() => {
    call<InitResponse>('init?from=card').then(setData, (e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    scene.current?.resize(layout);
  }, [layout]);

  useEffect(() => {
    if (!data || !canvas.current) return;
    const { level } = data.puzzle;
    const sc = new Scene(canvas.current, level, layout);
    scene.current = sc;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const push = still ? null : showPush(level);
    const reach = reaches(!!level.ice);
    const start = createState(level);
    let state = cloneState(start);
    let frame = 0;
    let t = 0;
    let acc = 0;
    let rest = 0;
    let sliding = false;
    let raf = 0;

    const logic = () => {
      frame++;
      if (!push) return;
      t++;
      if (t === GO_AT + WINDUP) {
        const all = movesAt(level, state, 0, push);
        launch(state, all);
        sc.launched(state, all);
        sliding = true;
        acc = 0;
      }
      if (sliding) {
        acc += TICKS_PER_FRAME;
        while (acc >= 1 && sliding) {
          acc -= 1;
          const ev = step(state, level);
          sc.tick(state);
          if (ev.length) sc.events(ev, state);
          if (!isMoving(state)) {
            sliding = false;
            rest = REST;
          }
        }
      } else if (rest > 0 && --rest === 0 && !sc.busy()) {
        state = cloneState(start);
        sc.reset();
        t = 0;
      } else if (rest === 0 && t > GO_AT + WINDUP) rest = 1; // effects still playing: look again next frame
    };

    const draw = () => {
      if (!push) return void sc.draw({ state, arrows: movesAt(level, state, 0, STAY), frame });
      if (t >= GO_AT + WINDUP) return void sc.draw({ state, arrows: null, frame });
      // The hand drags out from your slime and your arrow grows after it.
      const u = t < DRAG_FROM ? 0 : Math.min(1, (t - DRAG_FROM) / (DRAG_TO - DRAG_FROM));
      const eased = u * u * (3 - 2 * u);
      const mine: Move = { d: push.d, p: t < DRAG_FROM ? 0 : Math.max(1, Math.round(eased * push.p)) };
      const you = state.bodies[0];
      const [ux, uy] = DIR[push.d] ?? [0, 0];
      const far = (reach[push.p] ?? 30) * eased;
      const hand: Spot | null = you && t >= DRAG_FROM - 12 && t < GO_AT ? { x: you.x + ux * far, y: you.y + uy * far } : null;
      sc.draw({ state, arrows: movesAt(level, state, 0, mine), arrowT: t / 12, windup: t >= GO_AT, hand, frame });
    };

    let last = performance.now();
    let lag = 0;
    const loop = (at: number) => {
      lag = Math.min(lag + at - last, FRAME_MS * 4);
      last = at;
      let ran = false;
      while (lag >= FRAME_MS - 0.5) {
        logic();
        lag -= FRAME_MS;
        ran = true;
      }
      if (ran) draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) return <div className="screen-msg">{error}</div>;
  if (!data) return <div className="screen-msg">…</div>;
  const { puzzle, standing, streak, players } = data;
  const foes = puzzle.level.foes.length;

  return (
    <div className="play">
      <canvas ref={canvas} className="scene" style={{ width: vp.w * vp.scale, height: vp.h * vp.scale }} aria-hidden="true" />
      <div className="col">
        <div className="splash-top">
          <span className="logo small">Pushover</span>
          <span className="outlined">
            {puzzle.number > 0 ? `No. ${puzzle.number} · ${dayName(puzzle.weekday)}` : 'Test island'}
            {streak > 0 && ` · ${streak}-day streak`}
          </span>
        </div>
        <div className="spacer" />
        {!standing && players >= 5 && <p className="outlined center-text">{players} played. Can you clear it?</p>}
        <button className={`nine btn gold big ${standing ? '' : 'beckon'}`} onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}>
          {standing ? (standing.mine.best === foes ? 'See results' : 'Try again') : 'Play'}
          <span className="sub">
            {standing
              ? `Your best: ${standing.mine.best} of ${foes}${puzzle.number > 0 ? ` · next in ${fmtCountdown(msToNextIsland(now))}` : ''}`
              : `Push ${foes} slimes off in ${puzzle.level.turns} turns`}
          </span>
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
