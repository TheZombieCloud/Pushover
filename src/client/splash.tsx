import './fonts';
import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { InitResponse } from '../shared/api';
import { STAY, createState, movesAt } from '../shared/sim';
import { call } from './api';
import { Scene } from './scene';
import type { Layout } from './scene';
import { fmtCountdown, msToNextIsland, useNow } from './time';
import { useViewport } from './uiart';
import { dayName } from './words';

// Inline feed card: today's island, live, with the foes' first moves showing.
// One fetch, no game logic beyond drawing.
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
    const state = createState(level);
    const arrows = movesAt(level, state, 0, STAY);
    let frame = 0;
    let raf = 0;
    const loop = () => {
      sc.draw({ state, arrows, frame: frame++ });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (error) return <div className="screen-msg">{error}</div>;
  if (!data) return <div className="screen-msg">…</div>;
  const { puzzle, standing, streak } = data;
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
        <button className="nine btn gold big" onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}>
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
