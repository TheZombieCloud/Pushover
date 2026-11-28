import { DIR, dirFor } from './dirs.ts';

/*
 * Pushover's physics. One island, up to 7 slimes (you + 6 foes), simultaneous turns.
 *
 * Every turn each slime still on the island launches with its move for that turn: an
 * aim (0–71, 5° steps) and a power (0 = stay put, 1–8). Slimes slide, slow down by a
 * fixed friction and bounce off each other like equal-mass billiard balls. A slime
 * whose centre leaves the grass falls into the clouds. The turn ends when nothing moves.
 *
 * What else can vary an island (Terrain): boulders, which never move and which
 * everything bounces off; bumpers, which fling whoever hits them; fences along parts of
 * the coast, which bounce slimes back; ice, which has less friction so everything slides
 * further; wind, which bends every slide; and cracked grass ('%' in the shape), which
 * falls away at the end of a turn once a slime has slid off it.
 *
 * Deterministic by construction: fixed timestep, fixed iteration order, and only
 * + - * / and Math.sqrt (correctly rounded by IEEE 754, so identical in every engine).
 * The server replays a submitted run with this exact code to score it.
 */

export const CELL = 8;
export const COLS = 22;
export const ROWS = 22;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;
export const RADIUS = 7;
export const MAX_POWER = 6;
export const MAX_FOES = 6;
export const MAX_TURNS = 5;

const FRICTION = 0.07; // speed lost per tick, px/tick
const ICE_FRICTION = 0.04; // on a frozen island: the same push goes about 1.75x as far
const SUBSTEPS = 2;
const RESTITUTION = 0.96;
/**
 * How heavy your slime is next to a foe (each foe weighs 1). A little extra: a knock
 * moves you a bit less far than it would a foe, and your push sends a foe a bit
 * further. Kept as a fraction so the sums stay exact everywhere.
 */
const YOU_MASS = 1.25;
const ROCK_BOUNCE = 0.9;
/** A bumper's radius, and the speed it adds as it throws a slime back out. */
export const BUMPER_R = 6;
const BUMPER_KICK = 1.5;
const FENCE_BOUNCE = 0.75;
/** How much the wind adds each tick to anything that is moving (always less than friction). */
const WIND_PUSH = 0.022;
/** A bomb's blast: how far it reaches, and the speed it gives at the middle and at the edge. */
export const BOOM_R = 36;
const BOOM_NEAR = 2.6;
const BOOM_FAR = 0.8;
/** How hard a bomb has to be hit to go off. */
const BOOM_MIN = 0.3;
/** The two boulder sizes. */
export const ROCK_SIZES = [6, 8] as const;
export const MAX_ROCKS = 6;
const MAX_TICKS = 1200;
/** Lone travel distance per power step, roughly (the arrow preview is exact). */
export const PX_PER_POWER = 12;

export type Move = { d: number; p: number };
export type Spot = { x: number; y: number };
/**
 * How a foe decides its move each turn.
 *   chaser   charges at you. Blocked by a hole or an edge, it comes round.
 *   dodger   gets away from you, but cleverly: of the spots it can reach it picks
 *            the one with the most grass around it that is also far from you, so it
 *            never backs itself up against an edge.
 *   mirror   makes the opposite of the move you make, at the same moment. It is the
 *            only kind that reacts to your aim; the rest decide from where everyone
 *            stands as the turn starts.
 *   sleeper  never moves.
 *   bomb     never moves. The first time anything hits it, it goes off: everyone
 *            near it is thrown away from it, harder the closer they are.
 * None ever slides itself off the island or over a hole: each pulls up short or
 * stays put. They only leave when pushed.
 *
 * A foe with no kind is from an island posted before kinds existed: it follows its
 * stored list of moves, one per turn.
 */
export const FOE_KINDS = ['chaser', 'dodger', 'mirror', 'sleeper', 'bomb'] as const;
export type FoeKind = (typeof FOE_KINDS)[number];
export type Foe = Spot & { kind?: FoeKind; /** A chaser's strength. */ power?: number; moves?: Move[] };
/** How hard a chaser charges unless the island says otherwise. */
export const CHASE_POWER = 4;

/** Every move a player can make: standing still, or any of 72 aims at any strength up to MAX_POWER. */
export const AIM_MOVES: Move[] = [{ d: 0, p: 0 }];
for (let d = 0; d < 72; d++) for (let p = 1; p <= MAX_POWER; p++) AIM_MOVES.push({ d, p });
export type Rock = Spot & { r: number };
/** A fence: a straight rail from one point to the other, along the coast. */
export type Fence = { x1: number; y1: number; x2: number; y2: number };

/** What changes how things slide, apart from the island's outline. */
export type Terrain = {
  /** Boulders: fixed and round. Everything bounces off them. */
  rocks?: Rock[];
  /** Bumpers: fixed, small and round. They throw back whoever hits them, faster. */
  bumpers?: Spot[];
  /** Fences: rails that bounce slimes back instead of letting them over the edge. */
  fences?: Fence[];
  /** A frozen island: less friction, so everything slides further. */
  ice?: boolean;
  /** Wind: the direction (0-71) it blows. Everything that moves drifts with it. */
  wind?: number;
};

/** The bonus star: an extra goal for players who can already clear the island. */
export type StarGoal = 'spare' | 'combo';

export type Level = Terrain & {
  /** ROWS strings of COLS chars: '#' grass, '%' cracked grass, '.' sky. */
  shape: string[];
  you: Spot;
  foes: Foe[];
  turns: number;
  /** Best score the solver (or the level's maker) found. */
  par: number;
  /** The island's bonus star, if it has one. */
  star?: StarGoal;
};

/** `spent`: a bomb that has already gone off. */
export type Body = { x: number; y: number; vx: number; vy: number; alive: boolean; spent?: boolean };

export type SimEvent =
  | { kind: 'hit'; a: number; b: number; x: number; y: number; force: number }
  | { kind: 'bonk'; who: number; x: number; y: number; force: number; bumper?: boolean }
  | { kind: 'fall'; who: number; x: number; y: number; vx: number; vy: number }
  | { kind: 'boom'; who: number; x: number; y: number }
  | { kind: 'crumble'; cells: number[] };

/**
 * `gone`: cracked cells (row * COLS + col) that have fallen away, in order.
 * `trod`: cracked cells a slime has slid over that have not fallen yet.
 */
export type State = { bodies: Body[]; ticks: number; gone?: number[]; trod?: number[] };

export const STAY: Move = { d: 0, p: 0 };

const launchSpeed = (p: number) => (p <= 0 ? 0 : Math.sqrt(2 * FRICTION * PX_PER_POWER * p));
const frictionOf = (t: Terrain) => (t.ice ? ICE_FRICTION : FRICTION);

/** Half-width in pixels of the box blur that rounds the island's outline. */
const SMOOTH = 5;

/** Grass, cracked or not. */
const isGrassChar = (ch: string | undefined): boolean => ch === '#' || ch === '%';

const masks = new WeakMap<string[], Uint8Array>();

/**
 * The island as a BOARD_W x BOARD_H pixel mask (1 = grass). The level's cell grid is
 * blurred with a box and cut at half, which keeps straight edges exactly where the
 * cells put them, rounds corners and turns stair-steps into clean diagonals. Integer
 * sums only, so the mask is identical everywhere; the renderer draws this same mask,
 * so what you see is exactly where slimes fall.
 */
export const groundMask = (shape: string[]): Uint8Array => {
  const hit = masks.get(shape);
  if (hit) return hit;
  const W = BOARD_W;
  const H = BOARD_H;
  const cells = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = shape[Math.floor(y / CELL)];
    if (!row) continue;
    for (let x = 0; x < W; x++) if (isGrassChar(row[Math.floor(x / CELL)])) cells[y * W + x] = 1;
  }
  // Separable box sum: across, then down.
  const across = new Uint16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -SMOOTH; k <= SMOOTH; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < W) sum += cells[y * W + xx]!;
      }
      across[y * W + x] = sum;
    }
  const side = SMOOTH * 2 + 1;
  const need = Math.floor((side * side) / 2) + 1;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let k = -SMOOTH; k <= SMOOTH; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < H) sum += across[yy * W + x]!;
      }
      if (sum >= need) mask[y * W + x] = 1;
    }
  masks.set(shape, mask);
  return mask;
};

const onMask = (mask: Uint8Array, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < BOARD_W && y < BOARD_H && mask[Math.floor(y) * BOARD_W + Math.floor(x)] === 1;

export const isGround = (shape: string[], x: number, y: number): boolean => onMask(groundMask(shape), x, y);

/** The ground mask with fallen cracked cells cut out to their exact squares (for drawing). */
export const liveMask = (shape: string[], gone: number[]): Uint8Array => {
  const mask = new Uint8Array(groundMask(shape));
  for (const c of gone) {
    const x0 = (c % COLS) * CELL;
    const y0 = Math.floor(c / COLS) * CELL;
    for (let y = y0; y < y0 + CELL; y++) mask.fill(0, y * BOARD_W + x0, y * BOARD_W + x0 + CELL);
  }
  return mask;
};

/** The cell (row * COLS + col) a point is in, or -1 off the board. */
export const cellAt = (x: number, y: number): number =>
  x >= 0 && y >= 0 && x < BOARD_W && y < BOARD_H ? Math.floor(y / CELL) * COLS + Math.floor(x / CELL) : -1;

/**
 * Ground as it stands: the island, less any cracked cells that have fallen away. A
 * fallen cell is sky to its exact square (the renderer cuts the same square).
 */
const onLive = (mask: Uint8Array, gone: number[] | undefined, x: number, y: number): boolean =>
  onMask(mask, x, y) && !(gone && gone.length && gone.includes(cellAt(x, y)));

export const isLiveGround = (shape: string[], gone: number[] | undefined, x: number, y: number): boolean =>
  onLive(groundMask(shape), gone, x, y);

const isCracked = (shape: string[], cell: number): boolean => cell >= 0 && shape[Math.floor(cell / COLS)]?.[cell % COLS] === '%';

export const createState = (level: Level): State => ({
  bodies: [level.you, ...level.foes].map((s) => ({ x: s.x, y: s.y, vx: 0, vy: 0, alive: true })),
  ticks: 0,
});

export const cloneState = (s: State): State => ({
  bodies: s.bodies.map((b) => ({ ...b })),
  ticks: s.ticks,
  ...(s.gone ? { gone: [...s.gone] } : {}),
  ...(s.trod ? { trod: [...s.trod] } : {}),
});

/** Stored moves of an island from before kinds (see Foe): body 0 is you. */
export const turnMoves = (level: Level, turn: number, yours: Move): Move[] => [
  yours,
  ...level.foes.map((f) => f.moves?.[turn] ?? STAY),
];

/**
 * What everyone would like to do this turn, given where they stand: yours, then each
 * foe's by its kind. Chasers aim at wherever you are now (no trig: dirFor picks the
 * nearest of the 72 directions), so the same run always replays the same. Each foe
 * checks its own slide and nothing else: what happens after a bump is the game.
 */
export const movesAt = (level: Level, state: State, turn: number, yours: Move): Move[] => [
  yours,
  ...level.foes.map((f, i) => {
    if (!f.kind) return f.moves?.[turn] ?? STAY;
    if (f.kind === 'sleeper' || f.kind === 'bomb') return STAY;
    const gone = state.gone;
    const ground = (x: number, y: number) => isLiveGround(level.shape, gone, x, y);
    const me = state.bodies[0];
    const b = state.bodies[i + 1];
    if (!b?.alive) return STAY;
    // No foe ever takes itself off the island: each makes the strongest version of
    // its move that still lands it on the grass with room to spare, or stays put.
    // The whole slide has to stay on the grass even if nobody is in the way: you may
    // step aside, and a foe that then sails off the edge has thrown itself off.
    // `margin` is how much grass it wants around where it stops.
    const careful = (d: number, most: number, margin = 6): Move | null => {
      for (let p = most; p >= 1; p--) {
        const end = slideEnd(level, b, { d, p }, gone);
        if (end && [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]].every(([dx, dy]) => ground(end.x + dx!, end.y + dy!))) return { d, p };
      }
      return null;
    };
    if (f.kind === 'mirror') return (yours.p > 0 ? careful((yours.d + DIR.length / 2) % DIR.length, yours.p) : null) ?? STAY;
    if (f.kind === 'dodger') {
      if (!me?.alive) return STAY;
      // Room around a spot: the widest ring of eight points that is all grass.
      const room = (x: number, y: number) => {
        let r = 0;
        for (const ring of [6, 12, 18, 24, 30]) {
          for (let k = 0; k < 8; k++) {
            const [ux, uy] = DIR[k * 9]!;
            if (!ground(x + ux * ring, y + uy * ring)) return r;
          }
          r = ring;
        }
        return r;
      };
      // Room counts for more than distance from you. Staying is an option, but a
      // dodger is restless: it only sits still where moving would be clearly worse.
      let best: Move = STAY;
      let bestScore = room(b.x, b.y) * 3 + Math.min(90, Math.sqrt((b.x - me.x) ** 2 + (b.y - me.y) ** 2)) - 18;
      for (let d = 0; d < DIR.length; d += 6)
        for (const p of [2, 4]) {
          const end = slideEnd(level, b, { d, p }, gone);
          if (!end) continue;
          const space = room(end.x, end.y);
          if (space < 6) continue;
          const score = space * 3 + Math.min(90, Math.sqrt((end.x - me.x) ** 2 + (end.y - me.y) ** 2));
          if (score > bestScore) {
            bestScore = score;
            best = { d, p };
          }
        }
      return best;
    }
    if (!me?.alive) return STAY;
    const power = f.power ?? CHASE_POWER;
    // Straight at you if that is safe at any strength; otherwise a little to one side,
    // so a chaser blocked by a hole or an edge comes round instead of sitting still.
    const at = dirFor(me.x - b.x, me.y - b.y);
    let charge: Move = STAY;
    // A chaser is bold: it will stop right at an edge, and tries wider and wider to
    // one side before it gives up and stands still.
    for (const off of [0, 3, -3, 6, -6, 9, -9, 12, -12]) {
      const m = careful((at + off + DIR.length) % DIR.length, power, 2);
      if (m) {
        charge = m;
        break;
      }
    }
    return charge;
  }),
];

export const launch = (state: State, moves: Move[]): void => {
  state.ticks = 0;
  state.bodies.forEach((b, i) => {
    const m = moves[i] ?? STAY;
    if (!b.alive || m.p <= 0) return;
    const [ux, uy] = DIR[((m.d % DIR.length) + DIR.length) % DIR.length]!;
    const v = launchSpeed(Math.min(MAX_POWER, Math.round(m.p)));
    b.vx = ux * v;
    b.vy = uy * v;
  });
};

export const isMoving = (state: State): boolean =>
  state.ticks < MAX_TICKS && state.bodies.some((b) => b.alive && (b.vx !== 0 || b.vy !== 0));

const collide = (bodies: Body[], events: SimEvent[], bombs: boolean[]) => {
  const min = RADIUS * 2;
  const booms: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.alive) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.alive) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 === 0) {
        dx = 1;
        dy = 0;
        d2 = 1;
      }
      const dist = Math.sqrt(d2);
      const nx = dx / dist;
      const ny = dy / dist;
      // Push apart so they just touch.
      const push = (min - dist) / 2;
      a.x -= nx * push;
      a.y -= ny * push;
      b.x += nx * push;
      b.y += ny * push;
      // Closing speed along the line between centres.
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn <= 0) continue;
      // Body 0 is you, and a little heavier; i < j, so only a can be you.
      const ma = i === 0 ? YOU_MASS : 1;
      const impulse = (vn * (1 + RESTITUTION)) / (1 / ma + 1);
      a.vx -= (impulse / ma) * nx;
      a.vy -= (impulse / ma) * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
      events.push({ kind: 'hit', a: i, b: j, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, force: vn });
      if (vn >= BOOM_MIN)
        for (const k of [i, j])
          if (bombs[k] && !bodies[k]!.spent) {
            bodies[k]!.spent = true;
            booms.push(k);
          }
    }
  }
  // A bomb that was hit goes off: everyone near it is thrown away from it.
  for (const k of booms) {
    const bomb = bodies[k]!;
    events.push({ kind: 'boom', who: k, x: bomb.x, y: bomb.y });
    bodies.forEach((o, i) => {
      if (i === k || !o.alive) return;
      const dx = o.x - bomb.x;
      const dy = o.y - bomb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= BOOM_R * BOOM_R || d2 === 0) return;
      const d = Math.sqrt(d2);
      const v = (BOOM_FAR + (BOOM_NEAR - BOOM_FAR) * (1 - d / BOOM_R)) / (i === 0 ? YOU_MASS : 1);
      o.vx += (dx / d) * v;
      o.vy += (dy / d) * v;
    });
  }
};

/** Bounce one slime off any boulder, bumper or fence it has run into. */
const bounceOffTerrain = (b: Body, who: number, t: Terrain, events: SimEvent[] | null) => {
  bounceOffRocks(b, who, t.rocks, events);
  if (t.bumpers)
    for (const k of t.bumpers) {
      const min = RADIUS + BUMPER_R;
      let dx = b.x - k.x;
      let dy = b.y - k.y;
      let d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 === 0) {
        dx = 1;
        dy = 0;
        d2 = 1;
      }
      const dist = Math.sqrt(d2);
      const nx = dx / dist;
      const ny = dy / dist;
      b.x = k.x + nx * min;
      b.y = k.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) continue;
      // Reflect fully, then the kick: it always leaves faster than it came in.
      b.vx += (-2 * vn + BUMPER_KICK) * nx;
      b.vy += (-2 * vn + BUMPER_KICK) * ny;
      events?.push({ kind: 'bonk', who, x: k.x + nx * BUMPER_R, y: k.y + ny * BUMPER_R, force: BUMPER_KICK - vn, bumper: true });
    }
  if (t.fences)
    for (const f of t.fences) {
      const ex = f.x2 - f.x1;
      const ey = f.y2 - f.y1;
      const len2 = ex * ex + ey * ey;
      let u = len2 > 0 ? ((b.x - f.x1) * ex + (b.y - f.y1) * ey) / len2 : 0;
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const cx = f.x1 + ex * u;
      const cy = f.y1 + ey * u;
      const dx = b.x - cx;
      const dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= RADIUS * RADIUS || d2 === 0) continue;
      const dist = Math.sqrt(d2);
      const nx = dx / dist;
      const ny = dy / dist;
      b.x = cx + nx * RADIUS;
      b.y = cy + ny * RADIUS;
      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      b.vx -= (1 + FENCE_BOUNCE) * vn * nx;
      b.vy -= (1 + FENCE_BOUNCE) * vn * ny;
      events?.push({ kind: 'bonk', who, x: cx, y: cy, force: -vn });
    }
};

/** Bounce one slime off any boulder it has run into. */
const bounceOffRocks = (b: Body, who: number, rocks: Rock[] | undefined, events: SimEvent[] | null) => {
  if (!rocks) return;
  for (const rock of rocks) {
    const min = RADIUS + rock.r;
    let dx = b.x - rock.x;
    let dy = b.y - rock.y;
    let d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    if (d2 === 0) {
      dx = 1;
      dy = 0;
      d2 = 1;
    }
    const dist = Math.sqrt(d2);
    const nx = dx / dist;
    const ny = dy / dist;
    // Back out to the boulder's surface, then reflect the part of the speed heading in.
    b.x = rock.x + nx * min;
    b.y = rock.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) continue;
    b.vx -= (1 + ROCK_BOUNCE) * vn * nx;
    b.vy -= (1 + ROCK_BOUNCE) * vn * ny;
    events?.push({ kind: 'bonk', who, x: rock.x + nx * rock.r, y: rock.y + ny * rock.r, force: -vn });
  }
};

/** The wind's push this tick on something moving (nothing if there is no wind). */
const blow = (b: Body, t: Terrain) => {
  if (t.wind === undefined || (b.vx === 0 && b.vy === 0)) return;
  const [wx, wy] = DIR[((t.wind % DIR.length) + DIR.length) % DIR.length]!;
  b.vx += wx * WIND_PUSH;
  b.vy += wy * WIND_PUSH;
};

const slowDown = (b: Body, friction: number) => {
  const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (speed <= friction) {
    b.vx = 0;
    b.vy = 0;
  } else {
    const k = (speed - friction) / speed;
    b.vx *= k;
    b.vy *= k;
  }
};

/** Advance one tick. Returns what happened (hits, bounces, falls) for effects and scoring. */
export const step = (state: State, level: Terrain & { shape: string[]; foes?: Foe[] }): SimEvent[] => {
  const events: SimEvent[] = [];
  const { bodies } = state;
  const mask = groundMask(level.shape);
  const bombs = [false, ...(level.foes ?? []).map((f) => f.kind === 'bomb')];
  for (let s = 0; s < SUBSTEPS; s++) {
    for (const b of bodies) {
      if (!b.alive) continue;
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;
    }
    collide(bodies, events, bombs);
    bodies.forEach((b, who) => {
      if (b.alive) bounceOffTerrain(b, who, level, events);
    });
    bodies.forEach((b) => {
      // Cracked grass slid over: it falls away when the turn ends (see endTurn).
      if (!b.alive || (b.vx === 0 && b.vy === 0)) return;
      const c = cellAt(b.x, b.y);
      if (isCracked(level.shape, c) && !(state.trod ?? []).includes(c)) state.trod = [...(state.trod ?? []), c];
    });
    bodies.forEach((b, who) => {
      if (b.alive && !onLive(mask, state.gone, b.x, b.y)) {
        b.alive = false;
        events.push({ kind: 'fall', who, x: b.x, y: b.y, vx: b.vx, vy: b.vy });
        b.vx = 0;
        b.vy = 0;
      }
    });
  }
  const friction = frictionOf(level);
  for (const b of bodies)
    if (b.alive) {
      blow(b, level);
      slowDown(b, friction);
    }
  state.ticks += 1;
  return events;
};

/**
 * When everything has stopped: cracked grass that a slime slid over falls away,
 * unless a slime is standing on it (then it goes once they leave). Anyone left
 * standing over sky falls. Call once per turn, after the last step.
 */
export const endTurn = (state: State, level: Level): SimEvent[] => {
  if (!state.trod?.length) return [];
  const under = new Set(state.bodies.filter((b) => b.alive).map((b) => cellAt(b.x, b.y)));
  const cells = state.trod.filter((c) => !under.has(c));
  if (!cells.length) return [];
  state.trod = state.trod.filter((c) => under.has(c));
  state.gone = [...(state.gone ?? []), ...cells];
  const events: SimEvent[] = [{ kind: 'crumble', cells }];
  const mask = groundMask(level.shape);
  state.bodies.forEach((b, who) => {
    if (b.alive && !onLive(mask, state.gone, b.x, b.y)) {
      b.alive = false;
      events.push({ kind: 'fall', who, x: b.x, y: b.y, vx: 0, vy: 0 });
    }
  });
  return events;
};

/** Play one whole turn to rest. */
export const playTurn = (state: State, level: Level, turn: number, yours: Move): SimEvent[] => {
  launch(state, movesAt(level, state, turn, yours));
  const events: SimEvent[] = [];
  while (isMoving(state)) events.push(...step(state, level));
  for (const b of state.bodies) {
    b.vx = 0;
    b.vy = 0;
  }
  events.push(...endTurn(state, level));
  return events;
};

export const outs = (state: State): number => state.bodies.slice(1).filter((b) => !b.alive).length;
export const youFell = (state: State): boolean => !state.bodies[0]!.alive;

/** `star`: the island's bonus goal was met on this run. */
export type RunResult = { score: number; outs: number; fell: boolean; turnsPlayed: number; complete: boolean; star?: boolean };

/** The bonus goals, in a few words each. */
export const STAR_GOALS: Record<StarGoal, string> = {
  spare: 'Clear it with a turn to spare',
  combo: 'Push two off with one push',
};

/**
 * Replay a run. A run is complete when every turn is played, or you fell (the run
 * stops there, and you keep the foes you had already pushed off),
 * or every foe is already out (nothing left to push).
 */
export const runLevel = (level: Level, moves: Move[]): RunResult => {
  const state = createState(level);
  let turnsPlayed = 0;
  let combo = false;
  for (let t = 0; t < level.turns && t < moves.length; t++) {
    const before = outs(state);
    playTurn(state, level, t, moves[t]!);
    turnsPlayed++;
    if (outs(state) - before >= 2) combo = true;
    if (youFell(state) || outs(state) === level.foes.length) break;
  }
  const fell = youFell(state);
  const o = outs(state);
  const complete = fell || o === level.foes.length || turnsPlayed === level.turns;
  const cleared = !fell && o === level.foes.length;
  const star = level.star === 'spare' ? cleared && turnsPlayed < level.turns : level.star === 'combo' ? combo && !fell : false;
  return { score: o, outs: o, fell, turnsPlayed, complete, ...(level.star ? { star } : {}) };
};

/**
 * The path a slime takes if no other slime gets in its way: straight, except that it
 * still bounces off boulders. Returns the corner points, from where it starts to where
 * it stops. This is what an arrow draws, using the same steps as the real simulation.
 */
export const lonePath = (terrain: Terrain, from: Spot, m: Move): Spot[] => {
  const path: Spot[] = [{ x: from.x, y: from.y }];
  if (m.p <= 0) return path;
  const s: State = { bodies: [{ x: from.x, y: from.y, vx: 0, vy: 0, alive: true }], ticks: 0 };
  launch(s, [m]);
  const b = s.bodies[0]!;
  const friction = frictionOf(terrain);
  const bonks: SimEvent[] = [];
  let tick = 0;
  while (isMoving(s)) {
    for (let k = 0; k < SUBSTEPS; k++) {
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;
      bounceOffTerrain(b, 0, terrain, bonks);
      if (bonks.length) {
        path.push({ x: b.x, y: b.y });
        bonks.length = 0;
      }
    }
    blow(b, terrain);
    slowDown(b, friction);
    s.ticks++;
    // In wind the path bends: a corner every few ticks draws the curve.
    if (terrain.wind !== undefined && ++tick % 4 === 0) path.push({ x: b.x, y: b.y });
  }
  path.push({ x: b.x, y: b.y });
  return path;
};

/** Where a slime would stop if no other slime got in the way. */
export const landing = (from: Spot, m: Move, terrain: Terrain = {}): Spot => {
  const path = lonePath(terrain, from, m);
  return path[path.length - 1]!;
};

/**
 * Where a lone slime making this move comes to rest, or null if the slide would take
 * it over open sky on the way (a hole, a notch in the coast). It takes the very same
 * steps as the real thing and checks the ground at each one, so a slide judged safe
 * here cannot fall when it is played.
 */
export const slideEnd = (level: Level, from: Spot, m: Move, gone?: number[]): Spot | null => {
  if (m.p <= 0) return { x: from.x, y: from.y };
  const mask = groundMask(level.shape);
  const s: State = { bodies: [{ x: from.x, y: from.y, vx: 0, vy: 0, alive: true }], ticks: 0 };
  launch(s, [m]);
  const b = s.bodies[0]!;
  const friction = frictionOf(level);
  const bonks: SimEvent[] = [];
  while (isMoving(s)) {
    for (let k = 0; k < SUBSTEPS; k++) {
      b.x += b.vx / SUBSTEPS;
      b.y += b.vy / SUBSTEPS;
      bounceOffTerrain(b, 0, level, bonks);
      if (!onLive(mask, gone, b.x, b.y)) return null;
    }
    blow(b, level);
    slowDown(b, friction);
    s.ticks++;
  }
  return { x: b.x, y: b.y };
};

/** How far each power carries a lone slime on open ground (index = power). */
export const reaches = (ice: boolean): number[] =>
  Array.from({ length: MAX_POWER + 1 }, (_, p) => landing({ x: 0, y: 0 }, { d: 0, p }, { ice }).x);

export const isValidMove = (m: unknown): m is Move =>
  typeof m === 'object' &&
  m !== null &&
  'd' in m &&
  'p' in m &&
  Number.isInteger(m.d) &&
  Number.isInteger(m.p) &&
  Number(m.d) >= 0 &&
  Number(m.d) < DIR.length &&
  Number(m.p) >= 0 &&
  Number(m.p) <= MAX_POWER;
