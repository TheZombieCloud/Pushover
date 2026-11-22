import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { BOARD_W, CELL, COLS, FOE_KINDS, MAX_FOES, MAX_ROCKS, ROCK_SIZES, ROWS, STAY, createState, movesAt } from '../shared/sim';
import type { Rock, Spot } from '../shared/sim';
import { EDIT_TURNS, canStand, clearOf, rockClearOf, rockFits } from '../shared/validate';
import { draftLevel, starter } from './draft';
import type { Draft } from './draft';
import { KIND_INFO } from './kinds';
import { ISLAND_H, Scene } from './scene';
import type { Layout } from './scene';
import { sfx } from './sound';
import { SIDE_W, foePip, icon, iconSize, rockPip, useViewport, youPip } from './uiart';

/*
 * The island editor: shape the island, place the slimes and boulders, and pick each
 * foe's kind. Every tool refuses a change that would leave something off the grass
 * or overlapping, so the draft is always a valid layout and there are no error
 * states. The foes' arrows show what each would do on turn 1 as things stand. To
 * post the island its maker then plays it through on the play screen.
 */

type Tool = 'land' | 'hole' | 'you' | 'foe' | 'rock';

const HINTS: Record<Tool, string> = {
  land: 'Drag to add grass.',
  hole: 'Drag to cut the island away.',
  you: 'Drag your slime to where it starts.',
  foe: 'Tap the grass to add a foe. Tap a foe to change its kind.',
  rock: 'Tap to add a boulder. Tap it again to grow it, again to remove it.',
};

/** Fewest grass cells the island may be cut down to. */
const MIN_CELLS = 30;

type Drag =
  | { kind: 'paint' }
  | { kind: 'you' }
  | { kind: 'foe' | 'rock'; index: number; fresh: boolean; moved: boolean; from: Spot };

const near = (a: Spot, b: Spot, d: number) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 < d * d;
const snap = (p: Spot): Spot => ({ x: Math.round(p.x), y: Math.round(p.y) });

export type BuildProps = {
  draft: Draft;
  onChange: (draft: Draft) => void;
  /** On to playing it through. */
  onNext: () => void;
  onClose: () => void;
};

export const Build = ({ draft, onChange, onNext, onClose }: BuildProps) => {
  const vp = useViewport(290, true);
  const layout: Layout = useMemo(
    () =>
      vp.wide
        ? { w: vp.w, h: vp.h, boardX: Math.floor((vp.w - SIDE_W - BOARD_W) / 2), boardY: Math.max(22, Math.round(22 + (vp.h - 22 - ISLAND_H) * 0.4)), horizon: vp.h - 30 }
        : { w: vp.w, h: vp.h, boardY: Math.max(22, Math.round(22 + (vp.h - 22 - 112 - ISLAND_H) * 0.4)), horizon: vp.h - 62 },
    [vp]
  );
  const [tool, setTool] = useState<Tool>('land');
  /** What the last tap on a foe made it, said where the hint is. */
  const [note, setNote] = useState<string | null>(null);
  const level = useMemo(() => draftLevel(draft), [draft]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  // The latest draft, for pointer handlers that fire faster than React re-renders.
  const latest = useRef(draft);
  const levelRef = useRef(level);
  const drag = useRef<Drag | null>(null);
  const lastCell = useRef(-1);

  useEffect(() => {
    latest.current = draft;
    levelRef.current = level;
    sceneRef.current?.setLevel(level);
  }, [draft, level]);

  useEffect(() => {
    sceneRef.current?.resize(layout);
  }, [layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = sceneRef.current ?? new Scene(canvas, levelRef.current, layout);
    sceneRef.current = scene;
    let frame = 0;
    let raf = 0;
    const loop = () => {
      // The foes' arrows show what each would do on turn 1 from where things stand.
      const state = createState(levelRef.current);
      scene.draw({ state, arrows: movesAt(levelRef.current, state, 0, STAY), frame: frame++ });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: Draft) => {
    latest.current = next;
    onChange(next);
  };

  /** Paint or cut a small plus-shaped patch of cells under the pointer. */
  const paint = (p: Spot, on: boolean) => {
    const col = Math.floor(p.x / CELL);
    const row = Math.floor(p.y / CELL);
    if (row * COLS + col === lastCell.current) return;
    lastCell.current = row * COLS + col;
    const d = latest.current;
    const rows = d.shape.map((r) => [...r]);
    let changed = false;
    for (const [dr, dc] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const r = row + dr;
      const c = col + dc;
      // Keep a ring of sky around the board.
      if (r < 1 || c < 1 || r > ROWS - 2 || c > COLS - 2) continue;
      const want = on ? '#' : '.';
      if (rows[r]![c] !== want) {
        rows[r]![c] = want;
        changed = true;
      }
    }
    if (!changed) return;
    const shape = rows.map((r) => r.join(''));
    if (!on) {
      // Don't cut the ground from under anything, or cut the island away to nothing.
      const cells = shape.reduce((n, r) => n + [...r].filter((ch) => ch === '#').length, 0);
      const safe = cells >= MIN_CELLS && [d.you, ...d.foes].every((s) => canStand(shape, s)) && d.rocks.every((k) => rockFits(shape, k));
      if (!safe) return;
    }
    if (on) sfx.place();
    else sfx.cut();
    commit({ ...d, shape });
  };

  const slimeFits = (spot: Spot, except: number): boolean => {
    const d = latest.current;
    const others = [d.you, ...d.foes].filter((_, i) => i !== except);
    return canStand(d.shape, spot) && clearOf(spot, others, d.rocks);
  };
  const rockOk = (rock: Rock, except: number): boolean => {
    const d = latest.current;
    return rockFits(d.shape, rock) && rockClearOf(rock, [d.you, ...d.foes], d.rocks.filter((_, i) => i !== except));
  };

  const board = (e: PointerEvent<HTMLCanvasElement>): Spot | null => sceneRef.current?.toBoard(e.clientX, e.clientY) ?? null;

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = board(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = latest.current;
    const spot = snap(p);
    lastCell.current = -1;
    if (tool === 'land' || tool === 'hole') {
      drag.current = { kind: 'paint' };
      paint(p, tool === 'land');
    } else if (tool === 'you') {
      drag.current = { kind: 'you' };
      if (slimeFits(spot, 0)) commit({ ...d, you: spot });
    } else if (tool === 'foe') {
      const hit = d.foes.findIndex((f) => near(f, p, 10));
      if (hit >= 0) drag.current = { kind: 'foe', index: hit, fresh: false, moved: false, from: p };
      else if (d.foes.length < MAX_FOES && slimeFits(spot, -1)) {
        sfx.place();
        commit({ ...d, foes: [...d.foes, { ...spot, kind: 'chaser' }] });
        setNote(`${KIND_INFO.chaser.name}. ${KIND_INFO.chaser.line} Tap it to change.`);
        drag.current = { kind: 'foe', index: d.foes.length, fresh: true, moved: false, from: p };
      }
    } else {
      const hit = d.rocks.findIndex((k) => near(k, p, k.r + 3));
      if (hit >= 0) drag.current = { kind: 'rock', index: hit, fresh: false, moved: false, from: p };
      else if (d.rocks.length < MAX_ROCKS) {
        const rock: Rock = { ...spot, r: ROCK_SIZES[0] };
        if (rockOk(rock, -1)) {
          sfx.place();
          commit({ ...d, rocks: [...d.rocks, rock] });
          drag.current = { kind: 'rock', index: d.rocks.length, fresh: true, moved: false, from: p };
        }
      }
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = drag.current;
    const p = board(e);
    if (!g || !p) return;
    const d = latest.current;
    const spot = snap(p);
    if (g.kind === 'paint') paint(p, tool === 'land');
    else if (g.kind === 'you') {
      if (slimeFits(spot, 0)) commit({ ...d, you: spot });
    } else {
      if (!near(g.from, p, 3)) g.moved = true;
      if (!g.moved) return;
      if (g.kind === 'foe') {
        if (slimeFits(spot, g.index + 1)) commit({ ...d, foes: d.foes.map((f, i) => (i === g.index ? { ...spot, kind: f.kind } : f)) });
      } else {
        const old = d.rocks[g.index];
        if (old && rockOk({ ...spot, r: old.r }, g.index)) commit({ ...d, rocks: d.rocks.map((k, i) => (i === g.index ? { ...spot, r: old.r } : k)) });
      }
    }
  };

  const onPointerUp = () => {
    const g = drag.current;
    drag.current = null;
    if (!g || g.kind === 'paint' || g.kind === 'you' || g.fresh || g.moved) return;
    // A tap on something already there.
    const d = latest.current;
    if (g.kind === 'foe') {
      // Each tap makes it the next kind; after the last kind it goes.
      const old = d.foes[g.index];
      const next = old ? FOE_KINDS[FOE_KINDS.indexOf(old.kind) + 1] : undefined;
      if (old && next) {
        sfx.place();
        commit({ ...d, foes: d.foes.map((f, i) => (i === g.index ? { ...f, kind: next } : f)) });
        setNote(`${KIND_INFO[next].name}. ${KIND_INFO[next].line}${next === FOE_KINDS[FOE_KINDS.length - 1] ? ' Tap again to remove.' : ''}`);
      } else {
        sfx.cut();
        commit({ ...d, foes: d.foes.filter((_, i) => i !== g.index) });
        setNote(null);
      }
      return;
    }
    // A boulder grows once, then goes.
    const old = d.rocks[g.index];
    if (!old) return;
    const bigger: Rock = { ...old, r: ROCK_SIZES[1] };
    if (old.r === ROCK_SIZES[0] && rockOk(bigger, g.index)) {
      sfx.place();
      commit({ ...d, rocks: d.rocks.map((k, i) => (i === g.index ? bigger : k)) });
    } else {
      sfx.cut();
      commit({ ...d, rocks: d.rocks.filter((_, i) => i !== g.index) });
    }
  };

  const shuffle = () => commit(starter(Math.floor(Math.random() * 1e9), Math.max(2, draft.foes.length), draft));
  const setTurns = (n: number) => commit({ ...draft, turns: Math.max(EDIT_TURNS[0], Math.min(EDIT_TURNS[1], n)) });

  const tools: { id: Tool; label: string; img: string; size: [number, number] }[] = [
    { id: 'land', label: 'Add grass', img: icon('land'), size: [18, 14] },
    { id: 'hole', label: 'Cut away', img: icon('hole'), size: [18, 14] },
    { id: 'you', label: 'Move your slime', img: youPip(), size: [16, 16] },
    { id: 'foe', label: 'Foes', img: foePip(0, false), size: [16, 14] },
    { id: 'rock', label: 'Boulders', img: rockPip(), size: [13, 11] },
  ];
  const [cw, ch] = iconSize('close');

  return (
    <div className={`play ${vp.wide ? 'wide' : ''}`}>
      <canvas
        ref={canvasRef}
        className="scene"
        style={{ width: vp.w * vp.scale, height: vp.h * vp.scale }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Your island. Use the tools below to shape it."
        data-board={`${layout.boardX ?? Math.floor((vp.w - BOARD_W) / 2)},${layout.boardY},${vp.scale}`}
      />
      <div className="col">
        <div className="hud">
          <div className="turns outlined">
            <span className="lbl">Build an island</span>
          </div>
          <div className="hud-actions" style={{ marginLeft: 'auto' }}>
            <button className="nine btn square" onClick={onClose} aria-label="Leave the editor">
              <img className="px" src={icon('close')} alt="" style={{ width: `calc(${cw} * var(--px))`, height: `calc(${ch} * var(--px))` }} />
            </button>
          </div>
        </div>
        <div className="spacer" />
        <div className="controls">
          <p className="hint outlined">{tool === 'foe' ? (note ?? `${HINTS.foe} (${draft.foes.length} of ${MAX_FOES})`) : HINTS[tool]}</p>
          <div className="tools" role="group" aria-label="Tools">
            {tools.map((t) => (
              <button key={t.id} className={`nine btn tool ${tool === t.id ? 'on' : ''}`} onClick={() => {
                  setTool(t.id);
                  setNote(null);
                }} aria-label={t.label} aria-pressed={tool === t.id} title={t.label}>
                <img className="px" src={t.img} alt="" style={{ width: `calc(${t.size[0]} * var(--px))`, height: `calc(${t.size[1]} * var(--px))` }} />
              </button>
            ))}
          </div>
          <div className="options">
            <button className="nine btn" onClick={shuffle}>
              Shuffle
            </button>
            <button className="nine btn" onClick={() => commit({ ...draft, ice: !draft.ice })} aria-pressed={draft.ice}>
              {draft.ice ? 'Ice' : 'Grass'}
            </button>
            <div className="stepper outlined" aria-label={`${draft.turns} turns`}>
              <button className="nine btn square" onClick={() => setTurns(draft.turns - 1)} disabled={draft.turns <= EDIT_TURNS[0]} aria-label="Fewer turns">
                <img className="px" src={icon('minus')} alt="" style={{ width: 'calc(5 * var(--px))', height: 'calc(2 * var(--px))' }} />
              </button>
              <b>{draft.turns}</b>
              <button className="nine btn square" onClick={() => setTurns(draft.turns + 1)} disabled={draft.turns >= EDIT_TURNS[1]} aria-label="More turns">
                <img className="px" src={icon('plus')} alt="" style={{ width: 'calc(5 * var(--px))', height: 'calc(6 * var(--px))' }} />
              </button>
              <span>turns</span>
            </div>
          </div>
          <button className="nine btn gold big" onClick={onNext} disabled={draft.foes.length === 0}>
            Play it through
            <span className="sub">beat your island to post it</span>
          </button>
        </div>
      </div>
    </div>
  );
};
