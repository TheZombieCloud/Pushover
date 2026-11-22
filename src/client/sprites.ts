/*
 * Hand-drawn sprites, as rows of palette keys. Light comes from the top-left.
 *
 *   o outline   d shade   b body   l light   w shine   . empty
 *
 * A slime has four body frames (idle, a 1px-lower "breath", squashed, stretched) and
 * a face drawn on top, so the eyes can look around and blink without redrawing bodies.
 */

export type Ramp = { o: string; d: string; b: string; l: string; w: string; cheek: string; name: string };

export const INK = '#1a1026';

export const YOU: Ramp = { o: '#4a2c3f', d: '#dcb89a', b: '#fbe8cf', l: '#fffaf0', w: '#ffffff', cheek: '#ffb5a6', name: 'You' };

export const FOES: Ramp[] = [
  { o: '#5a1030', d: '#b02a4a', b: '#ee4b5a', l: '#ff8f80', w: '#ffe4dc', cheek: '#c7304f', name: 'Red' },
  { o: '#1c2466', d: '#2f58c8', b: '#4f8dff', l: '#93c6ff', w: '#eaf5ff', cheek: '#3a6ae0', name: 'Blue' },
  { o: '#33185f', d: '#7444cc', b: '#ab72ff', l: '#d5abff', w: '#f6ecff', cheek: '#8a55e0', name: 'Violet' },
  { o: '#6b1d55', d: '#d14f98', b: '#ff7fc6', l: '#ffb9e0', w: '#fff0f8', cheek: '#e85fa8', name: 'Pink' },
  { o: '#0e4a52', d: '#1b9a94', b: '#36d6c8', l: '#9cf3e3', w: '#edfffb', cheek: '#22b0a8', name: 'Teal' },
  { o: '#6e2a10', d: '#d06a1e', b: '#ff9b3d', l: '#ffd07c', w: '#fff5dc', cheek: '#e87c26', name: 'Orange' },
];

/** Knocked-out pips in the HUD. */
export const GHOST: Ramp = { o: '#3a2a55', d: '#4b3a6b', b: '#5d4a80', l: '#6f5c93', w: '#8474a8', cheek: '#5d4a80', name: 'Out' };

export const rampFor = (who: number): Ramp => (who === 0 ? YOU : FOES[(who - 1) % FOES.length]!);

export type FrameName = 'idle' | 'low' | 'squash' | 'tall';

type Frame = {
  rows: string[];
  /** Top row and height of the eyes, and the left pixel of each eye. */
  eyeY: number;
  eyeH: number;
  eyeL: number;
  eyeR: number;
  mouthX: number;
  mouthY: number;
  /** Rows above the sprite's top where the crown starts. */
  crownUp: number;
};

// A dome with a little tip, a shine on the lit side and a glint low on the far
// side, the way light passes through jelly.
const IDLE = [
  '.......oo.......',
  '......ollo......',
  '....oolllboo....',
  '...olwwllbbbo...',
  '..olwwllbbbbbo..',
  '.ollwllbbbbbbbo.',
  '.olllbbbbbbbbbo.',
  'ollbbbbbbbbbbbdo',
  'olbbbbbbbbbbbbdo',
  'olbbbbbbbbbbbbdo',
  'obbbbbbbbbbbbddo',
  'odbbbbbbbbbllddo',
  '.oddbbbbbbllddo.',
  '..oooooooooooo..',
];

const FRAMES: Record<FrameName, Frame> = {
  idle: { rows: IDLE, eyeY: 6, eyeH: 3, eyeL: 4, eyeR: 10, mouthX: 7, mouthY: 10, crownUp: 2 },
  // One row shorter: the bottom of a breath.
  low: { rows: IDLE.filter((_, i) => i !== 6), eyeY: 6, eyeH: 3, eyeL: 4, eyeR: 10, mouthX: 7, mouthY: 10, crownUp: 2 },
  squash: {
    rows: [
      '......oooooo......',
      '...ooollllbbooo...',
      '.oollwwlllbbbbboo.',
      'ollwwllbbbbbbbbbdo',
      'ollbbbbbbbbbbbbbdo',
      'olbbbbbbbbbbbbbbdo',
      'olbbbbbbbbbbbbbbdo',
      'obbbbbbbbbbbbbbddo',
      'odbbbbbbbbbbbllddo',
      '.oddbbbbbbbbllddo.',
      '..oooooooooooooo..',
    ],
    eyeY: 4,
    eyeH: 2,
    eyeL: 5,
    eyeR: 11,
    mouthX: 8,
    mouthY: 7,
    crownUp: 4,
  },
  tall: {
    rows: [
      '......oo......',
      '.....ollo.....',
      '....olllbo....',
      '...olwllbbo...',
      '..olwwlbbbbo..',
      '..olwlbbbbbo..',
      '.ollllbbbbbbo.',
      '.ollbbbbbbbbo.',
      'olbbbbbbbbbbdo',
      'olbbbbbbbbbbdo',
      'olbbbbbbbbbbdo',
      'obbbbbbbbbbddo',
      'obbbbbbbbbbddo',
      'obbbbbbbbblddo',
      'odbbbbbbbllddo',
      '.oddddddddddo.',
      '..oooooooooo..',
    ],
    eyeY: 8,
    eyeH: 3,
    eyeL: 3,
    eyeR: 9,
    mouthX: 6,
    mouthY: 12,
    crownUp: 2,
  },
};

const CROWN = ['.o..oo..o.', 'oyo.yy.oyo', 'ohyyyyyyyo', 'oyyyrryygo', 'oggggggggo', '.oooooooo.'];
const CROWN_COLORS: Record<string, string> = { o: '#5a3a14', y: '#ffd23f', h: '#fff3a8', g: '#e09a26', r: '#ee4b5a' };

/** The mirror's crown: the same shape as yours, cut out of paper. */
const PAPER_CROWN: Record<string, string> = { o: '#4a4458', y: '#f1ece2', h: '#ffffff', g: '#c9c2b6', r: '#f1ece2' };

type Ctx = CanvasRenderingContext2D;
type FoeKind = import('../shared/sim').FoeKind;

const put = (ctx: Ctx, x: number, y: number, color: string, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
};

/** Paints rows of palette keys; keys missing from `colors` (like '.') are skipped. */
export const drawRows = (ctx: Ctx, rows: string[], x: number, y: number, colors: Record<string, string>) => {
  rows.forEach((row, j) => {
    // Paint runs of the same key in one rect.
    let i = 0;
    while (i < row.length) {
      const key = row[i]!;
      let n = 1;
      while (row[i + n] === key) n++;
      const color = colors[key];
      if (color) put(ctx, x + i, y + j, color, n, 1);
      i += n;
    }
  });
};

export const spriteSize = (rows: string[]): [number, number] => [Math.max(...rows.map((r) => r.length)), rows.length];

export type Face = 'calm' | 'scared' | 'out';

export type SlimePose = {
  frame: FrameName;
  /** Eyes shift by whole pixels: -1, 0 or 1 across; 0 or 1 down. */
  lookX: number;
  lookY: number;
  blink: boolean;
  crown: boolean;
  face?: Face;
  /** Slanted brows: a foe that charges at you. */
  angry?: boolean;
  /** A paper crown: the mirror, which does the opposite of your move. */
  paper?: boolean;
};

/** Draws a slime standing on (cx, footY): footY is the bottom row of the sprite. */
export const drawSlime = (ctx: Ctx, cx: number, footY: number, ramp: Ramp, pose: SlimePose) => {
  const f = FRAMES[pose.frame];
  const w = f.rows[0]!.length;
  const x = Math.round(cx - w / 2);
  const y = Math.round(footY) - f.rows.length + 1;
  drawRows(ctx, f.rows, x, y, { o: ramp.o, d: ramp.d, b: ramp.b, l: ramp.l, w: ramp.w });

  const lx = Math.max(-1, Math.min(1, Math.round(pose.lookX)));
  const ly = Math.max(0, Math.min(1, Math.round(pose.lookY)));
  const ey = y + f.eyeY + ly;
  const face = pose.face ?? 'calm';
  [f.eyeL, f.eyeR].forEach((base, side) => {
    const ex = x + base + lx;
    if (face === 'out') {
      // Squeezed shut: > and <.
      const a = side === 0 ? 0 : 1;
      put(ctx, ex + a, ey, ramp.o);
      put(ctx, ex + 1 - a, ey + 1, ramp.o);
      if (f.eyeH > 2) put(ctx, ex + a, ey + 2, ramp.o);
    } else if (pose.blink) {
      put(ctx, ex, ey + f.eyeH - 2, ramp.o, 2, 1);
    } else {
      put(ctx, ex, ey, INK, 2, f.eyeH);
      put(ctx, ex, ey, '#ffffff');
    }
  });
  if (pose.angry && face === 'calm' && !pose.blink) {
    // Brows low at the inside, over each eye.
    put(ctx, x + f.eyeL - 1 + lx, ey - 2, ramp.o, 2, 1);
    put(ctx, x + f.eyeL + 1 + lx, ey - 1, ramp.o, 2, 1);
    put(ctx, x + f.eyeR + 1 + lx, ey - 2, ramp.o, 2, 1);
    put(ctx, x + f.eyeR - 1 + lx, ey - 1, ramp.o, 2, 1);
  }
  const mx = x + f.mouthX + lx;
  const my = y + f.mouthY + ly;
  if (face === 'scared') {
    put(ctx, mx, my - 1, ramp.o, 2, 2);
  } else if (face === 'calm') {
    // A small smile, and a blush under each eye.
    put(ctx, mx, my, ramp.o, 2, 1);
    put(ctx, mx - 1, my - 1, ramp.o);
    put(ctx, mx + 2, my - 1, ramp.o);
    put(ctx, x + f.eyeL - 1 + lx, my - 1, ramp.cheek, 2, 1);
    put(ctx, x + f.eyeR + 1 + lx, my - 1, ramp.cheek, 2, 1);
  } else {
    put(ctx, mx, my, ramp.o, 2, 1);
  }

  if (pose.crown) drawRows(ctx, CROWN, Math.round(cx - CROWN[0]!.length / 2), y - f.crownUp, CROWN_COLORS);
  if (pose.paper) drawRows(ctx, CROWN, Math.round(cx - CROWN[0]!.length / 2), y - f.crownUp, PAPER_CROWN);
};

// Boulders, in the two sizes the game uses, with a crack and a lit top-left.
const BOULDER_SMALL = [
  '....ooooo....',
  '..oollllboo..',
  '.ollwllbbbbo.',
  'ollwlbbbbbbdo',
  'olllbbbdbbbdo',
  'olbbbbbobbddo',
  'obbbbbbbobddo',
  'obbbdbbbddddo',
  '.odbbbdddddo.',
  '..oddddddoo..',
  '...oooooo....',
];
const BOULDER_BIG = [
  '.....ooooooo.....',
  '...oollllllboo...',
  '..ollwwlllbbbbo..',
  '.ollwwllbbbbbbbo.',
  '.olwwlbbbbbbbbbo.',
  'ollllbbbbbbbbbbdo',
  'olllbbbbdbbbbbbdo',
  'olbbbbbbbobbbbddo',
  'olbbbbbbbbobbbddo',
  'obbbbbbbbbbbbdddo',
  'obbdbbbbbbbbddddo',
  '.oddbbbbbbbddddo.',
  '..oodddddddddoo..',
  '....ooooooooo....',
];
const STONE = { o: '#2e1a2e', d: '#6f5a66', b: '#998890', l: '#c9bcb8', w: '#efe6dc' };
const FROSTED = { o: '#23324f', d: '#5f7896', b: '#8fa9c2', l: '#cfe3f2', w: '#ffffff' };

/** Draws a boulder centred on (x, y) with physics radius r. */
export const drawRock = (ctx: Ctx, x: number, y: number, r: number, ice: boolean) => {
  const big = r >= 8;
  const rows = big ? BOULDER_BIG : BOULDER_SMALL;
  drawRows(ctx, rows, Math.round(x - rows[0]!.length / 2), Math.round(y) + (big ? 7 : 5) - rows.length + 1, ice ? FROSTED : STONE);
};

/** A boulder as a PNG data URL, for the editor's tool button. */
export const rockIcon = (): string => {
  const c = document.createElement('canvas');
  c.width = BOULDER_SMALL[0]!.length;
  c.height = BOULDER_SMALL.length;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawRows(ctx, BOULDER_SMALL, 0, 0, STONE);
  return c.toDataURL();
};

// A pointing hand, for showing the drag once. The fingertip is at (3, 0).
const HAND = [
  '...oo.....',
  '..owwo....',
  '..owwo....',
  '..owwo....',
  '..owwooo..',
  '..owwwwwoo',
  'oowwwwwwwo',
  'owwwwwwwwo',
  'owwwwwwwwo',
  '.owwwwwwwo',
  '..owwwwwo.',
  '...ooooo..',
];
/** Draws the hand with its fingertip at (x, y). */
export const drawHand = (ctx: Ctx, x: number, y: number) => drawRows(ctx, HAND, Math.round(x) - 3, Math.round(y), { o: INK, w: '#fff3e3' });

export const SLIME_W = IDLE[0]!.length;
export const SLIME_H = IDLE.length;

/** A slime as a PNG data URL, for HUD pips and other DOM uses. */
export const slimeIcon = (ramp: Ramp, face: Face, crown = false, look: Partial<SlimePose> = {}): string => {
  const c = document.createElement('canvas');
  c.width = SLIME_W;
  c.height = SLIME_H + (crown || look.paper ? 2 : 0);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  drawSlime(ctx, SLIME_W / 2, c.height - 1, ramp, { frame: 'idle', lookX: 0, lookY: 0, blink: false, crown, face, ...look });
  return c.toDataURL();
};

/** How each kind of foe looks, so the island, the legend and the editor agree. */
export const kindLook = (kind: FoeKind | undefined): Partial<SlimePose> =>
  kind === 'chaser' ? { angry: true } : kind === 'dodger' ? { face: 'scared' } : kind === 'mirror' ? { paper: true } : kind === 'sleeper' ? { blink: true } : {};
