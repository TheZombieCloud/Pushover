import { DIR } from '../shared/dirs';
import { BOARD_H, BOARD_W, RADIUS, groundMask, lonePath } from '../shared/sim';
import type { Level, Move, SimEvent, Spot, State } from '../shared/sim';
import { UNDER, makeIsland } from './island';
import { CLOUD_BACK, CLOUD_FRONT, CLOUD_MID, cloudSprites, drawSky, makeBank } from './sky';
import { sfx } from './sound';
import type { Bounce, Ghost } from './guide';
import { INK, drawHand, drawRock, drawRows, drawSlime, rampFor } from './sprites';
import type { FrameName } from './sprites';

/*
 * The pixel renderer. The canvas covers the whole screen at one art pixel per
 * `scale` CSS pixels (nearest-neighbour), and the DOM UI is laid out on the same
 * pixel grid, so the island, the sky and the buttons are one picture.
 *
 * Layers, back to front: sky, drifting clouds, back cloud banks, slimes falling
 * behind the island, the island, trails, shadows, arrows, slimes, effects, slimes
 * falling in front, the front cloud bank.
 */

export type Layout = {
  /** View size in art pixels. */
  w: number;
  h: number;
  /** Top of the board in art pixels. */
  boardY: number;
  /** Where the cloud tops sit: slimes fall to here. */
  horizon: number;
  /** Left edge of the board in art pixels. Centred when left out. */
  boardX?: number;
};

/** Art-pixel height of the island including the rock under it. */
export const ISLAND_H = BOARD_H + UNDER;

type Ctx = CanvasRenderingContext2D;

const offscreen = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
};

const px = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
};

// ---- 3x5 pixel font for popups on the board ----
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '+': '000010111010000',
  O: '111101101101111', P: '111101111100100', S: '111100111001111', ' ': '000000000000000',
};

const drawText = (ctx: Ctx, text: string, x: number, y: number, color: string, outline: string) => {
  const glyphs = [...text.toUpperCase()].map((ch) => GLYPHS[ch] ?? GLYPHS[' ']!);
  const paint = (dx: number, dy: number, c: string) => {
    glyphs.forEach((g, i) => {
      for (let b = 0; b < 15; b++) if (g[b] === '1') px(ctx, x + i * 4 + (b % 3) + dx, y + Math.floor(b / 3) + dy, c);
    });
  };
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) paint(dx, dy, outline);
  paint(0, 0, color);
};
const textWidth = (text: string) => text.length * 4 - 1;

// "z Z" over a foe that is sitting this turn out: w white, k its shadow.
const SNOOZE = [
  ['www.', '.wk.', 'wwwk', '.kkk'],
  ['wwww.', '..wwk', '.wwk.', 'wwwwk', '.kkkk'],
];
const SNOOZE_COLORS = { w: '#fff3e3', k: INK };

// Impact bursts, small then large (hand-drawn): w white, y gold.
const BURST = [
  ['..w..', '.wyw.', 'wywyw', '.wyw.', '..w..'],
  ['....w....', '.w..w..w.', '..w.y.w..', '...yyy...', 'wwyy.yyww', '...yyy...', '..w.y.w..', '.w..w..w.', '....w....'],
  ['w...w...w', '.........', '....w....', '.........', 'w.w...w.w', '.........', '....w....', '.........', 'w...w...w'],
];
const BURST_COLORS = { w: '#ffffff', y: '#ffd23f' };

// ---- arrows ----
// Drawn as vector shapes on a small canvas, then snapped to hard pixels, so every
// angle gets a clean line instead of a hand-rolled staircase.
const PAD = 16;

const snap = (ctx: Ctx, w: number, h: number) => {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i]! > 100 ? 255 : 0;
  ctx.putImageData(img, 0, 0);
};

/** An arrow along a path: straight, or bent at each bounce off a boulder. */
type ArrowSpec = { points: Spot[]; d: number; mine: boolean };

const span = (a: Spot, b: Spot) => Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

/** The first part of a path, t of the way along it (0..1). */
const partOf = (points: Spot[], t: number): Spot[] => {
  if (t >= 1 || points.length < 2) return points;
  let left = points.slice(1).reduce((sum, p, i) => sum + span(points[i]!, p), 0) * Math.max(0, t);
  const out: Spot[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = span(a, b);
    if (len >= left) {
      const k = len > 0 ? left / len : 0;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      return out;
    }
    out.push(b);
    left -= len;
  }
  return out;
};

const traceArrow = (ctx: Ctx, a: ArrowSpec, grow: number, frame: number) => {
  const pts = a.points;
  const n = pts.length;
  if (n < 2) return;
  const total = pts.slice(1).reduce((sum, p, i) => sum + span(pts[i]!, p), 0);
  const unit = (p: Spot, q: Spot): readonly [number, number] => {
    const len = span(p, q);
    return len > 0.01 ? [(q.x - p.x) / len, (q.y - p.y) / len] : DIR[a.d]!;
  };
  const [fx, fy] = unit(pts[0]!, pts[1]!);
  const [ux, uy] = unit(pts[n - 2]!, pts[n - 1]!);
  const lead = Math.min(RADIUS + 3, span(pts[0]!, pts[1]!));
  const sx = pts[0]!.x + fx * lead + PAD;
  const sy = pts[0]!.y + fy * lead + PAD;
  const tipX = pts[n - 1]!.x + ux * 2 + PAD;
  const tipY = pts[n - 1]!.y + uy * 2 + PAD;
  const head = 7;
  const half = 4;
  const bx = tipX - ux * head;
  const by = tipY - uy * head;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  // Shaft.
  if (total + 2 - head - lead > 1) {
    ctx.lineWidth = 2 + grow * 2;
    ctx.setLineDash(a.mine ? [5, 3] : []);
    ctx.lineDashOffset = a.mine ? -(Math.floor(frame / 4) % 8) : 0;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    for (let i = 1; i < n - 1; i++) ctx.lineTo(pts[i]!.x + PAD, pts[i]!.y + PAD);
    ctx.lineTo(bx + ux, by + uy);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // Head.
  if (total + 2 - lead < 3) return;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx - uy * half, by + ux * half);
  ctx.lineTo(bx + uy * half, by - ux * half);
  ctx.closePath();
  ctx.fill();
  if (grow) {
    ctx.lineWidth = grow * 2;
    ctx.stroke();
  }
};

// ---- effects ----
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; g: number };
type Popup = { x: number; y: number; text: string; t: number; color: string };
type Faller = { who: number; x: number; y: number; vx: number; vy: number; t: number; behind: boolean; /** Fell into a hole in the island, not off its coast. */ hole: boolean };
/** Frames a slime takes to drop out of sight down a hole. */
const HOLE_FRAMES = 46;
type Burst = { x: number; y: number; t: number; big: boolean };
type TrailDot = { x: number; y: number; who: number; age: number };

export type DrawInput = {
  /** Positions to draw (the play loop passes positions eased between sim ticks). */
  state: State;
  /** Moves to preview as arrows (you first), or null while things slide. */
  arrows: Move[] | null;
  /** 0..1: how far the arrows have grown out since they appeared. */
  arrowT?: number;
  /**
   * The foes' moves on the turns after this one (one list per turn, you first). Drawn
   * as dotted trails carrying on from where each foe lands, so the whole plan shows.
   */
  future?: Move[][] | null;
  /** Which turn the arrows are for, counting from 1 (labels the trails). */
  turnNo?: number;
  /** Prototype aid: your arrow stops at the first slime you hit and shows where it goes. */
  bounce?: Bounce | null;
  /** The first-turn preview is playing: slimes are drawn see-through, so it reads as not real. */
  preview?: boolean;
  /** The first-turn preview: where everyone is in the rehearsal (marks who has fallen). */
  ghosts?: Ghost[] | null;
  /** True in the beat before launch: everyone about to move crouches. */
  windup?: boolean;
  /** How fast effects play, to match the playback speed: 1 is normal, 2 is twice as fast. */
  rate?: number;
  /** Show the pointing hand with its fingertip here (board coordinates). */
  hand?: Spot | null;
  /** Ring this slime as the one being aimed (the island editor). Yours is ringed by default. */
  ring?: number;
  frame: number;
};

export class Scene {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx;
  private layout: Layout;
  private sky: HTMLCanvasElement;
  private island: HTMLCanvasElement;
  private mask: Uint8Array;
  private level: Level;
  private readonly clouds: { img: HTMLCanvasElement; x: number; fy: number; speed: number }[];
  private readonly banks: { img: HTMLCanvasElement; rise: number; speed: number }[];
  private readonly arrowInk: [HTMLCanvasElement, Ctx];
  private readonly arrowFill: [HTMLCanvasElement, Ctx];
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private fallers: Faller[] = [];
  private scrap = Object.assign(document.createElement('canvas'), { width: 24, height: 24 });
  private bursts: Burst[] = [];
  private trail: TrailDot[] = [];
  private lastDot: ({ x: number; y: number } | undefined)[] = [];
  private squash: number[] = [];
  private shake = 0;
  // Effects run on their own clock so they can follow the playback speed.
  private clock = 0;
  private steps = 0;

  constructor(canvas: HTMLCanvasElement, level: Level, layout: Layout) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    this.layout = layout;
    this.level = level;
    this.mask = groundMask(level.shape);
    this.island = makeIsland(level.shape, !!level.ice);
    this.sky = canvas; // replaced in resize()
    this.banks = [
      { img: makeBank(256, 60, 11, CLOUD_BACK), rise: 30, speed: 0.06 },
      { img: makeBank(256, 60, 22, CLOUD_MID), rise: 18, speed: 0.11 },
      { img: makeBank(256, 60, 33, CLOUD_FRONT), rise: 6, speed: 0.2 },
    ];
    const sprites = cloudSprites();
    this.clouds = [
      { img: sprites[0]!, x: 6, fy: 0.1, speed: 0.04 },
      { img: sprites[1]!, x: 128, fy: 0.25, speed: 0.03 },
      { img: sprites[3]!, x: 60, fy: 0.55, speed: 0.05 },
      { img: sprites[2]!, x: 168, fy: 0.68, speed: 0.035 },
    ];
    this.arrowInk = offscreen(BOARD_W + PAD * 2, BOARD_H + PAD * 2);
    this.arrowFill = offscreen(BOARD_W + PAD * 2, BOARD_H + PAD * 2);
    this.resize(layout);
  }

  /** Left edge of the board in art pixels. */
  get boardX() {
    return this.layout.boardX ?? Math.floor((this.layout.w - BOARD_W) / 2);
  }

  resize(layout: Layout) {
    this.layout = layout;
    this.canvas.width = layout.w;
    this.canvas.height = layout.h;
    this.ctx.imageSmoothingEnabled = false;
    const [sky, skyCtx] = offscreen(layout.w, layout.h);
    drawSky(skyCtx, layout.w, layout.h, layout.horizon);
    this.sky = sky;
  }

  /** Show a different island (the editor redraws as it is painted). */
  setLevel(level: Level) {
    const redraw = level.shape !== this.level.shape || !!level.ice !== !!this.level.ice;
    this.level = level;
    if (!redraw) return;
    this.mask = groundMask(level.shape);
    this.island = makeIsland(level.shape, !!level.ice);
  }

  /** Clear everything left over from the last turn or run. */
  reset() {
    this.particles = [];
    this.popups = [];
    this.fallers = [];
    this.bursts = [];
    this.trail = [];
    this.lastDot = [];
    this.squash = [];
    this.shake = 0;
  }

  /** Board coordinates of a point on the page (for aiming by touch). */
  toBoard(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.layout.w - this.boardX,
      y: ((clientY - r.top) / r.height) * this.layout.h - this.layout.boardY,
    };
  }

  /** Everyone pushes off: puffs of grass, and last turn's trails are wiped. */
  launched(state: State, moves: Move[]) {
    this.trail = [];
    this.lastDot = [];
    state.bodies.forEach((b, i) => {
      const m = moves[i];
      if (!b.alive || !m || m.p <= 0) return;
      const [ux] = DIR[m.d]!;
      this.squash[i] = -0.6;
      for (let k = 0; k < 5; k++)
        this.particles.push({
          x: b.x - ux * 6 + (Math.random() - 0.5) * 5,
          y: b.y + 4,
          vx: -ux * (0.3 + Math.random() * 0.4) + (Math.random() - 0.5) * 0.4,
          vy: -0.5 - Math.random() * 0.4,
          life: 24,
          max: 24,
          color: k % 2 ? '#c0f284' : '#8ee060',
          g: 0.05,
        });
    });
  }

  /** Call once per simulation tick: leaves a dotted trail behind whoever is moving. */
  tick(state: State) {
    state.bodies.forEach((b, who) => {
      if (!b.alive || (b.vx === 0 && b.vy === 0)) return;
      const last = this.lastDot[who];
      if (last && (last.x - b.x) ** 2 + (last.y - b.y) ** 2 < 25) return;
      this.lastDot[who] = { x: b.x, y: b.y };
      this.trail.push({ x: b.x, y: b.y + 5, who, age: 0 });
    });
  }

  events(events: SimEvent[], state: State) {
    for (const e of events) {
      if (e.kind === 'hit') {
        const f = Math.min(1, e.force / 2.5);
        this.squash[e.a] = 0.4 + f * 0.6;
        this.squash[e.b] = 0.4 + f * 0.6;
        if (e.force > 1.2) this.shake = Math.max(this.shake, Math.round(1 + f));
        this.bursts.push({ x: e.x, y: e.y, t: 0, big: e.force > 1 });
        const n = 3 + Math.round(f * 4);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2 + Math.random();
          const sp = 0.5 + Math.random() * 0.8 * (0.5 + f);
          this.particles.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 16, max: 16, color: k % 2 ? '#ffffff' : '#ffd23f', g: 0 });
        }
      } else if (e.kind === 'bonk') {
        // Off a boulder: a small burst and a few chips of stone.
        this.squash[e.who] = 0.5;
        this.bursts.push({ x: e.x, y: e.y, t: 0, big: false });
        for (let k = 0; k < 4; k++)
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: (Math.random() - 0.5) * 1.6,
            vy: -0.4 - Math.random() * 0.8,
            life: 16,
            max: 16,
            color: k % 2 ? '#c9bcb8' : '#998890',
            g: 0.08,
          });
      } else {
        const hole = this.groundBelow(e.x, e.y) && this.groundAbove(e.x, e.y);
        // Off the far coast a slime drops behind the island. Down a hole it is drawn over
        // the opening, carrying on the way it was going, so it is seen going in.
        const behind = !hole && this.groundBelow(e.x, e.y);
        this.fallers.push({ who: e.who, x: e.x, y: e.y, vx: e.vx * 0.5, vy: hole ? e.vy * 0.5 : Math.min(e.vy * 0.5, 0) - 0.6, t: 0, behind, hole });
        this.popups.push({
          x: e.x,
          y: e.y - 16,
          text: e.who === 0 ? 'OOPS' : `+${state.bodies.slice(1).filter((b) => !b.alive).length}`,
          t: 0,
          color: e.who === 0 ? '#ffffff' : '#ffd23f',
        });
        this.shake = Math.max(this.shake, 2);
      }
    }
  }

  /** Is there grass further down this column? Then a slime falling here drops behind it. */
  private groundBelow(x: number, y: number) {
    const c = Math.round(x);
    if (c < 0 || c >= BOARD_W) return false;
    for (let r = Math.max(0, Math.round(y) + 1); r < BOARD_H; r++) if (this.mask[r * BOARD_W + c]) return true;
    return false;
  }

  private groundAbove(x: number, y: number) {
    const c = Math.round(x);
    if (c < 0 || c >= BOARD_W) return false;
    for (let r = Math.min(BOARD_H - 1, Math.round(y) - 1); r >= 0; r--) if (this.mask[r * BOARD_W + c]) return true;
    return false;
  }

  /** True while falls or popups are still playing out. */
  busy() {
    return this.fallers.length > 0 || this.popups.length > 0;
  }

  /** One 60-per-second step of every effect: falls, sparks, popups, bursts, trails. */
  private advance() {
    this.steps++;
    if (this.steps % 3 === 0 && this.shake > 0) this.shake--;
    for (let i = 0; i < this.squash.length; i++) {
      const sq = this.squash[i] ?? 0;
      this.squash[i] = Math.abs(sq) < 0.05 ? 0 : sq * 0.9;
    }
    const floor = this.layout.horizon - this.layout.boardY + 4;
    this.fallers = this.fallers.filter((f) => {
      f.t++;
      if (f.hole) {
        // Down a hole: seen from above it drops straight away from you, so it drifts a
        // little further in and shrinks until it is gone, then lands in the clouds below.
        f.x += f.vx;
        f.y += f.vy + 0.1;
        f.vx *= 0.88;
        f.vy *= 0.88;
        if (f.t < HOLE_FRAMES) return true;
      } else {
        f.x += f.vx;
        f.vx *= 0.97;
        f.vy += 0.07;
        f.y += f.vy;
        if (f.y < floor) return true;
      }
      // Into the clouds with a puff.
      sfx.poof();
      for (let k = 0; k < 12; k++)
        this.particles.push({
          x: f.x + (Math.random() - 0.5) * 12,
          y: floor,
          vx: (Math.random() - 0.5) * 1.4,
          vy: -0.6 - Math.random() * 1.1,
          life: 34,
          max: 34,
          color: k % 3 ? CLOUD_FRONT.hi : CLOUD_FRONT.base,
          g: 0.04,
        });
      return false;
    });
    this.particles = this.particles.filter((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.g;
      return --p.life > 0;
    });
    this.popups = this.popups.filter((p) => ++p.t <= 80);
    this.bursts = this.bursts.filter((b) => ++b.t <= (b.big ? 13 : 8));
    this.trail = this.trail.filter((d) => ++d.age <= 260);
  }

  draw(input: DrawInput) {
    const { ctx, layout } = this;
    const { state, frame } = input;
    const { w, h, horizon } = layout;
    // Effects keep pace with the chosen playback speed: more steps a frame when
    // fast, fewer when slow.
    this.clock += Math.min(6, input.rate ?? 1);
    while (this.clock >= 1) {
      this.advance();
      this.clock -= 1;
    }
    const shakeX = this.shake ? Math.round((Math.random() - 0.5) * 2 * this.shake) : 0;
    const shakeY = this.shake ? Math.round((Math.random() - 0.5) * 2 * this.shake) : 0;

    ctx.drawImage(this.sky, 0, 0);
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x > w + 4) c.x = -c.img.width - 4;
      ctx.drawImage(c.img, Math.round(c.x), Math.round(horizon * c.fy));
    }
    const bank = (i: number) => {
      const b = this.banks[i]!;
      const y = horizon - b.rise;
      const off = Math.floor(frame * b.speed) % b.img.width;
      for (let x = -off; x < w; x += b.img.width) ctx.drawImage(b.img, x, y);
      const below = y + b.img.height;
      if (below < h) px(ctx, 0, below, i === 2 ? CLOUD_FRONT.shade : i === 1 ? CLOUD_MID.shade : CLOUD_BACK.shade, w, h - below);
    };
    bank(0);
    bank(1);

    ctx.save();
    ctx.translate(this.boardX + shakeX, layout.boardY + shakeY);

    this.drawFallers(true);
    ctx.drawImage(this.island, 0, 0);
    this.drawTrail();

    const bodies = state.bodies;
    const rocks = this.level.rocks ?? [];
    const ice = !!this.level.ice;
    // Shadows, under slimes and boulders.
    ctx.fillStyle = ice ? 'rgba(43, 74, 122, 0.3)' : 'rgba(18, 56, 34, 0.4)';
    for (const b of bodies) {
      if (!b.alive) continue;
      const x = Math.round(b.x);
      const y = Math.round(b.y) + 6;
      ctx.fillRect(x - 6, y, 12, 1);
      ctx.fillRect(x - 7, y + 1, 14, 1);
      ctx.fillRect(x - 5, y + 2, 10, 1);
    }
    for (const k of rocks) {
      const x = Math.round(k.x);
      const y = Math.round(k.y) + (k.r >= 8 ? 7 : 5);
      ctx.fillRect(x - k.r, y, k.r * 2, 1);
      ctx.fillRect(x - k.r - 1, y + 1, k.r * 2 + 2, 1);
      ctx.fillRect(x - k.r + 1, y + 2, k.r * 2 - 2, 1);
    }
    // A gold ring on the ground that turns slowly: yours, or whoever is being aimed.
    const you = bodies[0]!;
    const ringed = bodies[input.ring ?? 0];
    if (ringed?.alive && input.arrows) {
      const r = 10 + (Math.floor(frame / 20) % 2);
      for (let i = 0; i < 40; i += 2) {
        const a = (i / 40) * Math.PI * 2 + frame * 0.01;
        px(ctx, ringed.x + Math.cos(a) * r, ringed.y + 5 + Math.sin(a) * r * 0.5, '#ffd23f');
      }
    }

    if (input.arrows && input.future && (input.arrowT ?? 1) >= 1) this.drawFuture(bodies, input.arrows, input.future, input.turnNo ?? 1);
    if (input.arrows) this.drawArrows(bodies, input.arrows, frame, input.arrowT ?? 1, input.bounce ?? null);
    if (input.ghosts) this.drawGhosts(input.ghosts);

    // Slimes and boulders, back to front.
    const order = [
      ...bodies.map((b, i) => ({ b: b.alive ? b : null, i, y: b.y, rock: -1 })).filter((o) => o.b),
      ...rocks.map((k, j) => ({ b: null, i: 100 + j, y: k.y, rock: j })),
    ].sort((p, q) => p.y - q.y || p.i - q.i);
    for (const { b, i, rock } of order) {
      if (!b) {
        const k = rocks[rock];
        if (k) drawRock(ctx, k.x, k.y, k.r, ice);
        continue;
      }
      const moving = b.vx !== 0 || b.vy !== 0;
      const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      const sq = this.squash[i] ?? 0;
      const m = input.arrows?.[i];
      let pose: FrameName = 'idle';
      if (input.windup && m && m.p > 0) pose = 'squash';
      else if (sq > 0.3 || (moving && speed > 1.2)) pose = 'squash';
      else if (sq < -0.3) pose = 'tall';
      else if (!moving && Math.floor((frame + i * 17) / 26) % 2 === 0) pose = 'low';
      let lx = 0;
      let ly = 0;
      if (moving) {
        lx = b.vx / speed;
        ly = b.vy / speed;
      } else if (m && m.p > 0) {
        lx = DIR[m.d]![0];
        ly = DIR[m.d]![1];
      } else if (i > 0 && you.alive) {
        const d = Math.sqrt((you.x - b.x) ** 2 + (you.y - b.y) ** 2) || 1;
        lx = (you.x - b.x) / d;
        ly = (you.y - b.y) / d;
      }
      // A foe with no move this turn is asleep: eyes shut, "z Z" drifting up.
      const kind = i > 0 ? this.level.foes[i - 1]?.kind : undefined;
      const asleep = !moving && i > 0 && (kind ? kind === 'sleeper' : !!input.arrows && !!m && m.p === 0);
      if (input.preview) ctx.globalAlpha = 0.55;
      drawSlime(ctx, b.x, b.y + 6, rampFor(i), {
        frame: pose,
        lookX: asleep ? 0 : Math.abs(lx) > 0.4 ? Math.sign(lx) : 0,
        lookY: asleep ? 0 : ly > 0.5 ? 1 : 0,
        blink: asleep || (frame + i * 53) % 190 < 7,
        crown: i === 0,
        angry: kind === 'chaser',
        paper: kind === 'mirror',
        face: kind === 'dodger' ? 'scared' : 'calm',
      });
      ctx.globalAlpha = 1;
      if (asleep) {
        const t = (frame + i * 23) % 90;
        const x = Math.round(b.x) + 6;
        const y = Math.round(b.y) - 12;
        if (t > 10) drawRows(ctx, SNOOZE[0]!, x + Math.floor(t / 45), y - Math.floor(t / 30), SNOOZE_COLORS);
        if (t > 40) drawRows(ctx, SNOOZE[1]!, x + 5 + Math.floor(t / 45), y - 7 - Math.floor(t / 30), SNOOZE_COLORS);
      }
    }

    this.drawBursts();
    this.drawParticles();
    this.drawFallers(false);
    this.drawPopups();
    if (input.hand) drawHand(ctx, input.hand.x, input.hand.y);
    ctx.restore();

    bank(2);
  }

  /**
   * Each foe's later moves: a dotted trail from where this turn's move leaves it,
   * then on from there, with the turn number where each one ends. A foe's moves are
   * fixed, so if it gets knocked somewhere else it makes the same moves from there.
   */
  private drawFuture(bodies: State['bodies'], moves: Move[], future: Move[][], turnNo: number) {
    const { ctx } = this;
    for (let i = 1; i < bodies.length; i++) {
      const b = bodies[i]!;
      const now = moves[i];
      if (!b.alive || !now) continue;
      const first = lonePath(this.level, b, now);
      let from = first[first.length - 1]!;
      const ramp = rampFor(i);
      future.forEach((turn, k) => {
        const m = turn[i];
        if (!m || m.p <= 0) return;
        const path = lonePath(this.level, from, m);
        let n = 0;
        for (let s = 1; s < path.length; s++) {
          const p0 = path[s - 1]!;
          const p1 = path[s]!;
          const len = Math.max(1, Math.round(span(p0, p1)));
          for (let j = 0; j <= len; j++, n++) {
            if (n % 4 > 1) continue;
            const x = p0.x + ((p1.x - p0.x) * j) / len;
            const y = p0.y + ((p1.y - p0.y) * j) / len;
            px(ctx, x, y + 1, INK);
            px(ctx, x, y, ramp.l);
          }
        }
        from = path[path.length - 1]!;
        drawText(ctx, String(turnNo + k + 1), Math.round(from.x) - 1, Math.round(from.y) - 2, ramp.l, INK);
      });
    }
  }

  /** The preview of a turn: a cross in a slime's colour where it went over the edge. */
  private drawGhosts(ghosts: Ghost[]) {
    const { ctx } = this;
    ghosts.forEach((g, i) => {
      if (g.alive) return;
      const color = i === 0 ? '#fff3e3' : rampFor(i).l;
      for (let k = -4; k <= 4; k++) {
        px(ctx, g.x + k - 1, g.y + k + 1, INK, 3, 2);
        px(ctx, g.x + k - 1, g.y - k + 1, INK, 3, 2);
      }
      for (let k = -4; k <= 4; k++) {
        px(ctx, g.x + k, g.y + k, color, 1, 2);
        px(ctx, g.x + k, g.y - k, color, 1, 2);
      }
    });
  }

  private drawArrows(bodies: State['bodies'], moves: Move[], frame: number, grow: number, bounce: Bounce | null) {
    const [inkC, ink] = this.arrowInk;
    const [fillC, fill] = this.arrowFill;
    const W = inkC.width;
    const H = inkC.height;
    ink.clearRect(0, 0, W, H);
    fill.clearRect(0, 0, W, H);
    ink.fillStyle = INK;
    ink.strokeStyle = INK;
    const t = Math.max(0, Math.min(1, grow));
    const specs: (ArrowSpec & { color: string; foot: string; end: Spot })[] = [];
    // Foes first, you last so your arrow sits on top.
    for (let i = bodies.length - 1; i >= 0; i--) {
      const b = bodies[i]!;
      const move = moves[i];
      if (!b.alive || !move || move.p <= 0) continue;
      // Where it goes if no other slime gets in the way, bounces off boulders included.
      const points = partOf(i === 0 && bounce ? bounce.path : lonePath(this.level, b, move), t);
      const ramp = rampFor(i);
      specs.push({
        points,
        end: points[points.length - 1]!,
        d: move.d,
        mine: i === 0,
        color: i === 0 ? '#fff3e3' : ramp.b,
        foot: i === 0 ? '#fff3e3' : ramp.l,
      });
    }
    for (const s of specs) {
      traceArrow(ink, s, 1, frame);
      fill.fillStyle = s.color;
      fill.strokeStyle = s.color;
      traceArrow(fill, s, 0, frame);
    }
    snap(ink, W, H);
    snap(fill, W, H);
    // Where each lands: a dotted footprint on the grass, under the arrows.
    if (t >= 1)
      for (const s of specs) {
        // Only on the grass: an arrow that ends in mid-air has nowhere to land.
        const ex = Math.round(s.end.x);
        const ey = Math.round(s.end.y);
        if (ex < 0 || ey < 0 || ex >= BOARD_W || ey >= BOARD_H || !this.mask[ey * BOARD_W + ex]) continue;
        for (let k = 0; k < 28; k += 2) {
          const a = (k / 28) * Math.PI * 2;
          px(this.ctx, s.end.x + Math.cos(a) * 8, s.end.y + 5 + Math.sin(a) * 4, s.foot);
        }
      }
    this.ctx.drawImage(inkC, -PAD, -PAD);
    this.ctx.drawImage(fillC, -PAD, -PAD);
    // The pool-table guide: a dotted line from the slime you'll hit to where it ends up.
    const struck = bounce ? bodies[bounce.hit.who] : null;
    if (bounce && struck && t >= 1) {
      const to = bounce.hit.to;
      const color = rampFor(bounce.hit.who).l;
      const len = Math.max(1, Math.round(span(struck, to)));
      for (let j = 0; j <= len; j++) {
        if (j % 4 > 1) continue;
        const x = struck.x + ((to.x - struck.x) * j) / len;
        const y = struck.y + ((to.y - struck.y) * j) / len;
        px(this.ctx, x, y + 1, INK);
        px(this.ctx, x, y, color);
      }
      for (let k = 0; k < 32; k += 2) {
        const a = (k / 32) * Math.PI * 2;
        px(this.ctx, to.x + Math.cos(a) * 7, to.y + Math.sin(a) * 6, color);
      }
    }
  }

  private drawTrail() {
    const { ctx } = this;
    for (const d of this.trail) {
      // Fades by thinning out: every dot, then every other, then gone.
      if (d.age > 200 && (Math.round(d.x) + Math.round(d.y)) % 2) continue;
      const ramp = rampFor(d.who);
      const x = Math.round(d.x);
      const y = Math.round(d.y);
      if (d.age < 140) {
        px(ctx, x - 1, y, ramp.o, 3, 2);
        px(ctx, x, y, d.who === 0 ? '#fff3e3' : ramp.l, 1, 1);
        px(ctx, x - 1, y, d.who === 0 ? '#fff3e3' : ramp.b, 1, 1);
      } else px(ctx, x, y, d.who === 0 ? '#fff3e3' : ramp.b);
    }
  }

  private drawBursts() {
    const { ctx } = this;
    for (const b of this.bursts) {
      const stage = b.t < 4 ? 0 : b.t < 9 ? 1 : 2;
      const rows = b.big ? BURST[stage]! : BURST[0]!;
      const size = rows.length;
      drawRows(ctx, rows, Math.round(b.x - size / 2), Math.round(b.y - size / 2), BURST_COLORS);
    }
  }

  private drawFallers(behind: boolean) {
    const { ctx } = this;
    for (const f of this.fallers) {
      if (f.behind !== behind) continue;
      const pose = { frame: 'tall', lookX: 0, lookY: 0, blink: false, crown: f.who === 0, face: 'scared' } as const;
      if (!f.hole) {
        drawSlime(ctx, f.x, f.y + 6, rampFor(f.who), pose);
        continue;
      }
      // Drawn small on a scrap canvas, then shrunk in whole pixels as it falls away.
      const scrap = this.scrap;
      const sc = scrap.getContext('2d');
      if (!sc) continue;
      sc.clearRect(0, 0, scrap.width, scrap.height);
      drawSlime(sc, scrap.width / 2, scrap.height - 1, rampFor(f.who), pose);
      const k = Math.max(0.2, 1 - f.t / (HOLE_FRAMES + 6));
      const w = Math.max(2, Math.round(scrap.width * k));
      const h = Math.max(2, Math.round(scrap.height * k));
      ctx.drawImage(scrap, Math.round(f.x - w / 2), Math.round(f.y + 6 - h), w, h);
    }
  }

  private drawParticles() {
    const { ctx } = this;
    for (const p of this.particles) {
      const s = p.life > p.max / 2 ? 2 : 1;
      px(ctx, p.x, p.y, p.color, s, s);
    }
  }

  private drawPopups() {
    const { ctx } = this;
    for (const p of this.popups) {
      const y = p.y - Math.min(10, p.t * 0.4);
      drawText(ctx, p.text, Math.round(p.x - textWidth(p.text) / 2), Math.round(y), p.color, INK);
    }
  }
}
