import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';
import { DIR, DIRS, dirFor } from '../shared/dirs';
import { BOARD_W, CELL, FOE_KINDS, MAX_POWER, STAR_GOALS, STAY, createState, endTurn, isGround, isMoving, landing, launch, movesAt, outs, reaches, runLevel, step, turnMoves, youFell } from '../shared/sim';
import type { SimEvent } from '../shared/sim';
import type { Level, Move, RunResult, Spot, State } from '../shared/sim';
import { rehearsal, showPush } from './guide';
import type { Ghost } from './guide';
import { KIND_INFO } from './kinds';
import { ISLAND_H, Scene } from './scene';
import type { Layout } from './scene';
import { setMuted, sfx, useMuted } from './sound';
import { PACING, loadSpeed, nextSpeed, saveSpeed } from './speed';
import type { Speed } from './speed';
import { SIDE_W, TERRAIN_INFO, foePip, icon, iconSize, kindPip, terrainOf, terrainPip, useViewport } from './uiart';
import type { Viewport } from './uiart';

type Phase = 'aim' | 'windup' | 'slide' | 'settle' | 'over';

/**
 * play:   you aim your slime; the foes move by their kind.
 * watch:  a run plays back by itself (a replay). Nothing can be changed.
 */
export type PlayMode = 'play' | 'watch';

export type PlayProps = {
  level: Level;
  mode?: PlayMode;
  /** Moves to play back: the replay in watch mode, or a scripted run for recordings. */
  script?: Move[] | null;
  /** Called after each turn settles with every move of yours so far. */
  onTurn?: (moves: Move[]) => void;
  /** Called once when the run is over (all turns played, you fell, or no foes left). */
  onDone: (moves: Move[], result: RunResult) => void;
  onEvent?: (action: 'start') => void;
  /**
   * This is the player's first push ever, on any post: the hand shows them a drag, and
   * they can watch turn 1 play out before they commit.
   */
  preview?: boolean;
  /** Leave a replay, or a test run in the editor. Shows a close button. */
  onClose?: () => void;
  /** False while a sheet (title, results) covers the screen: hides the HUD and controls. */
  active: boolean;
  /** Sheets drawn over the scene. */
  children?: ReactNode;
};

// How a turn is shown. The player picks the pacing with the speed button (speed.ts);
// the simulation itself always runs at its own fixed tick, so results never change.
const FRAME_MS = 1000 / 60;
/** Ticks per frame while the island is held down during a slide, whatever the speed. */
const HOLD_SPEED = 2.4;
const ARROW_GROW_FRAMES = 12;
// The first-turn preview, in frames: how long the aim must hold still before it plays,
// simulation ticks shown per frame going forward and winding back, and how long it
// holds on the result. It plays once for each aim.
const PREVIEW_SETTLE = 26;
const PREVIEW_RATE = 0.6;
const PREVIEW_REWIND = 2.2;
const PREVIEW_HOLD = 45;

// Art-pixel heights the layout reserves for the HUD and the controls.
const HUD_H = 22;
const CONTROLS_H = 100;

const gameLayout = (v: Viewport): Layout => {
  // Wide windows: the island takes the left of the screen, centred top to bottom,
  // and the controls stand beside it.
  if (v.wide)
    return {
      w: v.w,
      h: v.h,
      boardX: Math.floor((v.w - SIDE_W - BOARD_W) / 2),
      boardY: Math.max(HUD_H, Math.round(HUD_H + (v.h - HUD_H - ISLAND_H) * 0.4)),
      horizon: v.h - 30,
    };
  return {
    w: v.w,
    h: v.h,
    boardY: Math.max(HUD_H, Math.round(HUD_H + (v.h - HUD_H - CONTROLS_H - ISLAND_H) * 0.4)),
    horizon: v.h - 62,
  };
};

const result = (state: State, turnsPlayed: number): RunResult => {
  const fell = youFell(state);
  const o = outs(state);
  return { score: o, outs: o, fell, turnsPlayed, complete: true };
};

const Icon = ({ name }: { name: string }) => {
  const [w, h] = iconSize(name);
  return <img className="px" src={icon(name)} alt="" style={{ width: `calc(${w} * var(--px))`, height: `calc(${h} * var(--px))` }} />;
};

/** One run of an island. Remount it (change its key) to start over. */
export const Play = ({ level, mode = 'play', script = null, onTurn, onDone, onEvent, preview: wantPreview = false, onClose, active, children }: PlayProps) => {
  const watching = mode === 'watch';
  const vp = useViewport(290, true);
  const layout = useMemo(() => gameLayout(vp), [vp]);
  // How far each power carries a lone slime here (further on ice), for drag-to-aim.
  const reach = useMemo(() => reaches(!!level.ice), [level.ice]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const sim = useRef<State>(createState(level));
  /** Your move each turn so far. */
  const moves = useRef<Move[]>([]);
  const phase = useRef<Phase>('aim');

  // Your move for the coming turn. It starts aimed, at zero power, toward the first
  // foe, so the first nudge makes sense.
  const [firstPlan] = useState<Move>(() => ({ d: level.foes[0] ? dirFor(level.foes[0].x - level.you.x, level.foes[0].y - level.you.y) : 0, p: 0 }));
  const planRef = useRef<Move>(firstPlan);
  const [plan, setPlanState] = useState<Move>(firstPlan);
  /** The who's-who sheet. */
  const [help, setHelp] = useState(false);

  const dragging = useRef(false);
  // Playback state for the loop (see the pacing notes above).
  const pending = useRef<Move[] | null>(null);
  const phaseFrames = useRef(0);
  const simAcc = useRef(1);
  const freeze = useRef(0);
  const before = useRef<Spot[]>([]);
  const fast = useRef(false);

  const [turn, setTurn] = useState(0);
  // Where everyone stands between turns (also published on the canvas for recordings).
  const [spots, setSpots] = useState<string>(() => JSON.stringify([level.you, ...level.foes].map((s) => ({ x: s.x, y: s.y, alive: true }))));
  const [busy, setBusy] = useState(false);
  const [knocked, setKnocked] = useState<boolean[]>(() => level.foes.map(() => false));
  const [touched, setTouched] = useState(false);
  const [over, setOver] = useState(false);
  // Playback speed: remembered per browser, read by the loop through the ref.
  const [speed, setSpeed] = useState<Speed>(loadSpeed);
  const speedRef = useRef<Speed>(speed);
  const [flash, setFlash] = useState<string | null>(null);
  /** The bonus star has been earned on this run. */
  const [starNow, setStarNow] = useState(false);
  const starRef = useRef(false);
  const flashTimer = useRef(0);
  const muted = useMuted();
  // The hand that demonstrates the drag, and the preview of turn 1: only for a player's
  // first push ever (the server keeps that per account). Decided when the run starts,
  // so it lasts through turn 1 and no longer.
  const [coachAtStart] = useState(() => mode === 'play' && !script && wantPreview);
  const coach = useRef(coachAtStart);
  /** Is the play screen showing (no title card or sheet over it)? For the loop. */
  const onScreen = useRef(active);
  // What the hand demonstrates: a push that sends one slime off the island. If no
  // single push here does, a short push that stays on the island, toward its middle,
  // and clear of the lines to the foes (where their arrows are) when it can be.
  const [demo] = useState<Move>(() => {
    if (!coachAtStart) return STAY;
    const lead = showPush(level);
    if (lead) return lead;
    // A foe that moves this turn may be charging: its arrow then carries on past you,
    // so the far side of you is taken as well.
    const opening = movesAt(level, createState(level), 0, STAY);
    const bearings = level.foes.flatMap((f, i) => {
      const toward = dirFor(f.x - level.you.x, f.y - level.you.y);
      return (opening[i + 1]?.p ?? 0) > 0 ? [toward, (toward + DIRS / 2) % DIRS] : [toward];
    });
    const openness = (d: number) => Math.min(DIRS, ...bearings.map((b) => Math.min(Math.abs(d - b), DIRS - Math.abs(d - b))));
    // The middle of the grass, as seen from your slime.
    let sx = 0;
    let sy = 0;
    let cells = 0;
    level.shape.forEach((row, r) => {
      for (let c = 0; c < row.length; c++)
        if (row[c] === '#') {
          sx += (c + 0.5) * CELL;
          sy += (r + 0.5) * CELL;
          cells++;
        }
    });
    const mx = cells ? sx / cells - level.you.x : 0;
    const my = cells ? sy / cells - level.you.y : 0;
    const far = Math.sqrt(mx * mx + my * my);
    const inward = (d: number) => (far < 6 ? 0 : (DIR[d]![0] * mx + DIR[d]![1] * my) / far);
    let best: Move = { d: bearings[0] ?? 0, p: 1 };
    let bestScore = -Infinity;
    for (let d = 0; d < DIRS; d += 3)
      for (const p of [3, 2]) {
        const end = landing(level.you, { d, p }, level);
        if (!isGround(level.shape, end.x, end.y)) continue;
        const score = inward(d) + (Math.min(openness(d), 6) / 6) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = { d, p };
        }
        break;
      }
    return best;
  });
  const demoRef = useRef(demo);
  // A player's first push ever (on any post), first turn only: once the aim holds still, the slimes play the turn
  // out as aimed and wind back to where they stood, so a new player watches a whole
  // turn before spending one. Nothing is played for real until Push. It plays once for
  // an aim; any change of aim puts everyone back at once and starts the wait again.
  const preview = useRef<{ d: number; p: number; frames: Ghost[][] } | null>(null);
  const previewClock = useRef(0);
  const previewOn = useRef(false);
  const [previewing, setPreviewing] = useState(false);


  const setPlan = useCallback((next: Move) => {
    const prev = planRef.current;
    if (prev.p !== next.p || prev.d !== next.d) sfx.tick();
    planRef.current = next;
    setPlanState(next);
  }, []);

  /** Everyone's moves for the coming turn. */
  const movesNow = useCallback((): Move[] => movesAt(level, sim.current, moves.current.length, planRef.current), [level]);

  const noteTouched = () => {
    setTouched(true);
    if (coach.current) {
      coach.current = false;
    }
  };

  const cycleSpeed = () => {
    const next = nextSpeed(speedRef.current);
    speedRef.current = next;
    setSpeed(next);
    saveSpeed(next);
    // Say what it changed to, where the hint is, for a moment.
    setFlash(`Speed: ${PACING[next].label}`);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1400);
  };
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const syncKnocked = () => setKnocked(sim.current.bodies.slice(1).map((b) => !b.alive));
  const syncSpots = () => setSpots(JSON.stringify(sim.current.bodies.map((b) => ({ x: Math.round(b.x), y: Math.round(b.y), alive: b.alive }))));

  const push = useCallback(
    (mine?: Move) => {
      if (phase.current !== 'aim') return;
      if (mine) planRef.current = mine;
      const all = movesNow().map((m) => ({ ...m }));
      if (moves.current.length === 0) onEvent?.('start');
      moves.current = [...moves.current, all[0] ?? STAY];
      // A beat of wind-up first, arrows still showing, then the loop launches everyone.
      pending.current = all;
      phase.current = 'windup';
      phaseFrames.current = 0;
      if (coach.current) {
        coach.current = false;
      }
      setBusy(true);
    },
    [movesNow, onEvent]
  );

  // Keep the scene sized to the screen.
  useEffect(() => {
    sceneRef.current?.resize(layout);
  }, [layout]);

  // When the title card or a sheet closes, start the turn's little animations over:
  // the arrows grow out again and the hand begins its demonstration from the top.
  useEffect(() => {
    onScreen.current = active;
    if (active && phase.current === 'aim') phaseFrames.current = 0;
  }, [active]);

  // The loop. Game logic runs at a steady 60 frames a second whatever the screen's
  // refresh rate. While sliding, the simulation is stepped at the chosen speed and
  // positions are eased between ticks, so slow playback stays smooth.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = sceneRef.current ?? new Scene(canvas, level, layout);
    sceneRef.current = scene;
    let frame = 0;
    let raf = 0;

    /** Effects and sounds for what just happened. */
    const heard = (ev: SimEvent[]) => {
      scene.events(ev, s0());
      for (const e of ev) {
        if (e.kind === 'hit') sfx.bump(e.force);
        else if (e.kind === 'bonk') sfx.bonk(e.force);
        else if (e.kind === 'boom') {
          sfx.bump(3);
          sfx.bonk(3);
        } else if (e.kind === 'crumble') sfx.poof();
        else {
          sfx.fall();
          if (e.who === 0) sfx.oops();
          else sfx.score(outs(s0()));
        }
      }
      if (ev.some((e) => e.kind === 'fall')) syncKnocked();
    };
    const s0 = () => sim.current;

    const logic = () => {
      frame++;
      phaseFrames.current++;
      const s = sim.current;
      const pace = PACING[speedRef.current];
      if (phase.current === 'windup') {
        if (phaseFrames.current >= pace.windup && pending.current) {
          launch(s, pending.current);
          scene.launched(s, pending.current);
          sfx.launch(Math.max(0, ...pending.current.map((m, i) => (s.bodies[i]?.alive ? m.p : 0))));
          before.current = s.bodies.map((b) => ({ x: b.x, y: b.y }));
          simAcc.current = 0;
          freeze.current = 0;
          phase.current = 'slide';
        }
      } else if (phase.current === 'slide') {
        if (freeze.current > 0) {
          freeze.current--;
          return;
        }
        simAcc.current += fast.current ? HOLD_SPEED : pace.sim;
        while (simAcc.current >= 1 && phase.current === 'slide') {
          simAcc.current -= 1;
          before.current = s.bodies.map((b) => ({ x: b.x, y: b.y }));
          const ev = step(s, level);
          scene.tick(s);
          if (ev.length) heard(ev);
          if (!isMoving(s)) {
            for (const b of s.bodies) {
              b.vx = 0;
              b.vy = 0;
            }
            // Cracked grass that was slid over falls away now.
            const after = endTurn(s, level);
            if (after.length) {
              heard(after);
              scene.setGone(s.gone);
            }
            simAcc.current = 1;
            phase.current = 'settle';
            phaseFrames.current = 0;
            break;
          }
          // Hold on a solid hit for a few frames so the eye can catch it.
          const hardest = Math.max(0, ...ev.map((e) => (e.kind === 'hit' || e.kind === 'bonk' ? e.force : 0)));
          if (hardest > 0.6 && !fast.current) {
            freeze.current = Math.round((3 + Math.min(1, hardest / 2.5) * 5) * pace.hitStop);
            simAcc.current = 0.999;
            break;
          }
        }
      } else if (phase.current === 'settle') {
        if (phaseFrames.current > pace.settle && !scene.busy()) {
          const played = moves.current.length;
          setTurn(played);
          if (level.star && !starRef.current && runLevel(level, moves.current).star) {
            starRef.current = true;
            setStarNow(true);
            sfx.score(9);
            setFlash('Bonus star!');
            window.clearTimeout(flashTimer.current);
            flashTimer.current = window.setTimeout(() => setFlash(null), 1800);
          }
          syncSpots();
          onTurn?.(moves.current);
          const end = youFell(s) || outs(s) === level.foes.length || played >= level.turns;
          if (end) {
            phase.current = 'over';
            setOver(true);
            onDone(moves.current, { ...runLevel(level, moves.current), ...result(s, played) });
          } else {
            phase.current = 'aim';
            phaseFrames.current = 0;
          }
          fast.current = false;
          setBusy(false);
        }
      }
    };

    const draw = () => {
      const s = sim.current;
      const p = phase.current;
      // Between ticks, show each slime part-way from where it was to where it is.
      const t = Math.min(1, simAcc.current);
      const shown: State =
        p === 'slide'
          ? {
              ...s,
              bodies: s.bodies.map((b, i) => {
                const from = before.current[i];
                return b.alive && from ? { ...b, x: from.x + (b.x - from.x) * t, y: from.y + (b.y - from.y) * t } : b;
              }),
            }
          : s;
      let arrows = p === 'aim' ? movesNow() : p === 'windup' ? pending.current : null;
      // First time: a hand drags out from your slime and the arrow grows after it,
      // on a loop, until the player touches anything.
      let hand: Spot | null = null;
      const you = s.bodies[0];
      const show = demoRef.current;
      if (coach.current && onScreen.current && p === 'aim' && moves.current.length === 0 && arrows && you) {
        const c = phaseFrames.current % 170;
        const u = c < 25 ? 0 : c < 90 ? (c - 25) / 65 : c < 125 ? 1 : -1;
        if (u >= 0) {
          const eased = u * u * (3 - 2 * u);
          const [ux, uy] = DIR[show.d]!;
          const far = (reach[show.p] ?? 30) * eased;
          hand = { x: you.x + ux * far, y: you.y + uy * far };
          arrows = [{ d: show.d, p: Math.max(1, Math.round(eased * show.p)) }, ...arrows.slice(1)];
        }
      }
      // Islands from before kinds: dotted trails show each foe's stored later moves.
      const turnAt = p === 'windup' ? moves.current.length - 1 : moves.current.length;
      const future =
        level.foes.every((f) => !f.kind) && (p === 'aim' || p === 'windup')
          ? Array.from({ length: Math.max(0, level.turns - turnAt - 1) }, (_, k) => turnMoves(level, turnAt + 1 + k, STAY))
          : null;
      let stage = shown;
      let ghosts: Ghost[] | null = null;
      let rehearsing = false;
      if (coachAtStart && !coach.current && p === 'aim' && moves.current.length === 0 && arrows) {
        const mine = arrows[0] ?? STAY;
        if (mine.p > 0) {
          if (!preview.current || preview.current.d !== mine.d || preview.current.p !== mine.p) {
            preview.current = { d: mine.d, p: mine.p, frames: rehearsal(level, s, arrows) };
            previewClock.current = 0;
          }
          const frames = preview.current.frames;
          const last = frames.length - 1;
          const play = Math.ceil(last / PREVIEW_RATE);
          const rewind = Math.ceil(last / PREVIEW_REWIND);
          const c = previewClock.current++ - PREVIEW_SETTLE;
          const k = c < 0 ? -1 : c;
          const at =
            k < 0
              ? -1
              : k < play
                ? k * PREVIEW_RATE
                : k < play + PREVIEW_HOLD
                  ? last
                  : k < play + PREVIEW_HOLD + rewind
                    ? last - (k - play - PREVIEW_HOLD) * PREVIEW_REWIND
                    : -1;
          const now = at < 0 ? null : frames[Math.max(0, Math.min(last, Math.round(at)))];
          const next = at < 0 ? null : frames[Math.max(0, Math.min(last, Math.round(at) + 1))];
          if (now && next) {
            rehearsing = true;
            // The real slimes, shown where the rehearsal has them. The arrows are put
            // away while it plays; a cross stays where anyone went over the edge.
            stage = {
              ticks: s.ticks,
              bodies: now.map((g, i) => ({ x: g.x, y: g.y, vx: (next[i]?.x ?? g.x) - g.x, vy: (next[i]?.y ?? g.y) - g.y, alive: g.alive })),
            };
            ghosts = now;
            arrows = null;
          }
        }
      } else preview.current = null;
      if (rehearsing !== previewOn.current) {
        previewOn.current = rehearsing;
        setPreviewing(rehearsing);
      }
      scene.draw({
        state: stage,
        arrows,
        ghosts,
        preview: rehearsing,
        future,
        turnNo: turnAt + 1,
        arrowT: p === 'aim' ? phaseFrames.current / ARROW_GROW_FRAMES : 1,
        windup: p === 'windup',
        // Falls, popups and sparks follow the playback speed while a turn plays out.
        rate: p === 'aim' || p === 'over' ? 1 : (fast.current ? HOLD_SPEED : PACING[speedRef.current].sim) / PACING.normal.sim,
        hand,
        frame,
      });
    };

    let last = performance.now();
    let lag = 0;
    const loop = (now: number) => {
      lag = Math.min(lag + now - last, FRAME_MS * 4);
      last = now;
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
  }, [level]);

  // Scripted play (replays and recordings): sweep the aim into place, then push.
  useEffect(() => {
    if (!script || over || !active) return;
    if (busy || turn >= script.length) return;
    const target = script[turn]!;
    const from = planRef.current;
    const frames = 18;
    const pause = watching ? 8 : 25;
    let k = 0;
    const id = window.setInterval(() => {
      k++;
      if (k <= frames) {
        const t = k / frames;
        let dd = target.d - from.d;
        if (dd > DIRS / 2) dd -= DIRS;
        if (dd < -DIRS / 2) dd += DIRS;
        setPlan({ d: (((from.d + Math.round(dd * t)) % DIRS) + DIRS) % DIRS, p: Math.round(from.p + (target.p - from.p) * t) });
      } else if (k > frames + pause) {
        window.clearInterval(id);
        push(target);
      }
    }, 40);
    return () => window.clearInterval(id);
  }, [script, busy, turn, over, active, watching, push, setPlan]);

  // Drag on the island to aim: the direction of the drag, and the strength whose
  // reach is nearest to its length.
  const powerForDrag = (dist: number) => {
    if (dist < 8) return 0;
    let best = 1;
    for (let p = 1; p <= MAX_POWER; p++) if (Math.abs(reach[p]! - dist) < Math.abs(reach[best]! - dist)) best = p;
    return best;
  };
  const aimAt = (clientX: number, clientY: number) => {
    const scene = sceneRef.current;
    const body = sim.current.bodies[0];
    if (!scene || !body) return;
    const p = scene.toBoard(clientX, clientY);
    const dx = p.x - body.x;
    const dy = p.y - body.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    setPlan({ d: dist < 1 ? planRef.current.d : dirFor(dx, dy), p: powerForDrag(dist) });
    noteTouched();
  };

  const canAim = !script && !watching && active;
  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // While things are sliding, holding the island fast-forwards.
    if (phase.current === 'windup' || phase.current === 'slide') {
      fast.current = true;
      return;
    }
    if (phase.current !== 'aim' || !canAim) return;
    dragging.current = true;
    aimAt(e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (dragging.current && phase.current === 'aim') aimAt(e.clientX, e.clientY);
  };
  const onPointerUp = () => {
    dragging.current = false;
    fast.current = false;
  };

  /** One notch round, or one step of power. */
  const nudge = (dd: number, dp: number) => {
    const m = planRef.current;
    setPlan({ d: (((m.d + dd) % DIRS) + DIRS) % DIRS, p: Math.max(0, Math.min(MAX_POWER, m.p + dp)) });
    noteTouched();
  };

  const aiming = !busy && !over && canAim && !help;
  const turnsLeft = level.turns - turn;
  // The kinds on this island, each shown as the first foe of that kind.
  const cast = FOE_KINDS.flatMap((kind) => {
    const i = level.foes.findIndex((f) => f.kind === kind);
    return i < 0 ? [] : [{ kind, i }];
  });
  const hint = flash
    ? flash
    : busy
      ? 'Hold the island to fast-forward.'
      : watching
        ? 'Your best run.'
        : !touched
          ? 'Drag to aim. Arrows show what each slime does this turn.'
          : plan.p === 0
            ? 'No power: you stay put this turn.'
            : previewing
              ? 'This is what your push would do. Nothing has moved yet.'
              : coachAtStart && turn === 0
                ? 'Hold your aim still to see the turn play out. First turn only.'
            : turnsLeft === 1
              ? 'Last turn.'
              : 'Everyone moves at once. No take-backs.';

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
        aria-label="The island. Drag to aim."
        data-board={`${layout.boardX ?? Math.floor((vp.w - BOARD_W) / 2)},${layout.boardY},${vp.scale}`}
        data-slimes={spots}
      />
      {active && (
        <div className="col">
          <div className="hud">
            <div className="turns outlined" aria-label={`Turn ${Math.min(turn + 1, level.turns)} of ${level.turns}`}>
              <span className="lbl">{watching ? 'Replay' : 'Turn'}</span>
              {Array.from({ length: level.turns }, (_, i) => (
                <span key={i} className={`pip ${i < turn ? 'done' : i === turn && !over ? 'now' : ''}`} />
              ))}
              {level.star && (
                <span
                  className={`star-icon hud-star ${starNow ? 'got' : ''}`}
                  role="img"
                  aria-label={`Bonus star${starNow ? ' earned' : ''}: ${STAR_GOALS[level.star]}`}
                  title={STAR_GOALS[level.star]}
                />
              )}
            </div>
            <div className="foes" aria-label={`${knocked.filter(Boolean).length} of ${level.foes.length} pushed off`}>
              {level.foes.map((_, i) => (
                <img key={i} className="px" src={level.foes[i]?.kind === 'bomb' && !knocked[i] ? kindPip(i, 'bomb') : foePip(i, !!knocked[i])} alt="" />
              ))}
            </div>
            <div className="hud-actions">
              {/* No undo and no restart: every push is final. */}
              {!watching && cast.length > 0 && (
                <button className="nine btn square" onClick={() => setHelp(true)} disabled={busy || over} aria-label="Who’s who">
                  <Icon name="help" />
                </button>
              )}
              {onClose && (
                <button className="nine btn square" onClick={onClose} aria-label={watching ? 'Close the replay' : 'Back to the island'}>
                  <Icon name="close" />
                </button>
              )}
            </div>
          </div>
          {previewing && <p className="preview-tag">Preview</p>}
          <div className="spacer" />
          {!over && (
            <div className="controls">
              <p className="hint outlined">{hint}</p>
              {!watching && (
                <div className="aim-row">
                  <button className="nine btn square" onClick={() => nudge(-1, 0)} disabled={!aiming} aria-label="Turn aim left">
                    <Icon name="ccw" />
                  </button>
                  <div className="power" aria-label={`Power ${plan.p} of ${MAX_POWER}`}>
                    <button className="nine btn square" onClick={() => nudge(0, -1)} disabled={!aiming} aria-label="Less power">
                      <Icon name="minus" />
                    </button>
                    <div className="meter">
                      {Array.from({ length: MAX_POWER }, (_, i) => (
                        <span key={i} className={`bar ${i < plan.p ? 'on' : ''}`} style={{ height: `calc(${3 + i} * var(--px))` }} />
                      ))}
                    </div>
                    <button className="nine btn square" onClick={() => nudge(0, 1)} disabled={!aiming} aria-label="More power">
                      <Icon name="plus" />
                    </button>
                  </div>
                  <button className="nine btn square" onClick={() => nudge(1, 0)} disabled={!aiming} aria-label="Turn aim right">
                    <Icon name="cw" />
                  </button>
                </div>
              )}
              <div className="push-row">
                <button
                  className="nine btn speed"
                  onClick={() => setMuted(!muted)}
                  aria-label={muted ? 'Sound is off. Tap to turn it on.' : 'Sound is on. Tap to mute.'}
                  title={muted ? 'Sound off' : 'Sound on'}
                >
                  <Icon name={muted ? 'soundOff' : 'soundOn'} />
                </button>
                <button className="nine btn gold big" onClick={() => push()} disabled={!aiming}>
                  {watching ? 'Replay' : plan.p === 0 ? 'Hold' : 'Push!'}
                  <span className="sub">
                    {watching ? 'watching your best run' : `${turnsLeft} ${turnsLeft === 1 ? 'turn' : 'turns'} left`}
                  </span>
                </button>
                {/* One, two or three chevrons: slow, normal, fast. Works mid-slide too. */}
                <button
                  className="nine btn speed"
                  onClick={cycleSpeed}
                  aria-label={`Speed: ${PACING[speed].label}. Tap to change.`}
                  title={`Speed: ${PACING[speed].label}`}
                >
                  <Icon name={`speed${PACING[speed].chevrons}`} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {help && (
        <div className="overlay">
          <div className="nine panel sheet">
            <p className="kicker">Who’s who</p>
            <ul className="legend">
              {cast.map(({ kind, i }) => (
                <li key={kind}>
                  <img className="px" src={kindPip(i, kind)} alt="" />
                  <span>
                    <b>{KIND_INFO[kind].name}</b> {KIND_INFO[kind].line}
                  </span>
                </li>
              ))}
            </ul>
            <p className="center-text">Nobody leaves the island unless pushed.</p>
            {terrainOf(level).length > 0 && (
              <>
                <p className="kicker">On this island</p>
                <ul className="legend">
                  {terrainOf(level).map((t) => (
                    <li key={t}>
                      <img className="px" src={terrainPip(t)} alt="" />
                      <span>
                        <b>{TERRAIN_INFO[t].name}</b> {TERRAIN_INFO[t].line(level)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {level.star && (
              <p className={`star-goal ${starNow ? 'got' : ''}`}>
                <span className="star-icon" aria-hidden="true" />
                Bonus: {STAR_GOALS[level.star]}
              </p>
            )}
            <button className="nine btn gold big" onClick={() => setHelp(false)}>
              Got it
            </button>
          </div>
        </div>
      )}
      {children}
    </div>
  );
};
