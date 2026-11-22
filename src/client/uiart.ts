import { useEffect, useState } from 'react';
import type { FoeKind } from '../shared/sim';
import { FOES, GHOST, YOU, drawRows, kindLook, rockIcon, slimeIcon } from './sprites';

/*
 * UI drawn as pixel art, from the scene's own palette, and laid out on the scene's
 * pixel grid. Panels and buttons are tiny 12x12 sprites used as CSS border-images
 * (nine-slice), scaled by the same whole number as the canvas, so one art pixel is
 * the same size everywhere on screen.
 */

const COLORS: Record<string, string> = {
  k: '#2a1630', // ink outline
  W: '#c07f52', // wood, lit
  w: '#96593f', // wood
  s: '#6b3d3a', // wood, shaded
  p: '#fbe9c6', // paper
  h: '#fff3a8', // gold, lit
  y: '#ffcd3c', // gold
  d: '#d4902a', // gold, shaded
  G: '#b6f07a', // grass, lit
  g: '#5cb848', // grass
  l: '#3f8f3e', // grass, shaded
  e: '#1f4a2e', // grass outline
  c: '#fff3e3', // cream
  x: '#3a2030', // icon shadow
};

const box = (top: string, body: string, low: string, edge = 'k') => [
  `.${edge.repeat(10)}.`,
  `${edge}${top.repeat(10)}${edge}`,
  `${edge}${top}${body.repeat(9)}${edge}`,
  ...Array.from({ length: 6 }, () => `${edge}${body.repeat(10)}${edge}`),
  `${edge}${low.repeat(10)}${edge}`,
  `${edge}${low.repeat(10)}${edge}`,
  `.${edge.repeat(10)}.`,
];

/** The same button pushed in: one row lower, with a thinner base. */
const pressed = (body: string, low: string, edge = 'k') => [
  '............',
  `.${edge.repeat(10)}.`,
  ...Array.from({ length: 8 }, () => `${edge}${body.repeat(10)}${edge}`),
  `${edge}${low.repeat(10)}${edge}`,
  `.${edge.repeat(10)}.`,
];

const SPRITES: Record<string, string[]> = {
  // A paper sheet in a wooden frame.
  panel: [
    '.kkkkkkkkkk.',
    'kWWWWWWWWWWk',
    'kWwwwwwwwwsk',
    'kWwkkkkkkwsk',
    ...Array.from({ length: 4 }, () => 'kWwkppppkwsk'),
    'kWwkkkkkkwsk',
    'kWwwwwwwwwsk',
    'kssssssssssk',
    '.kkkkkkkkkk.',
  ],
  gold: box('h', 'y', 'd'),
  'gold-down': pressed('y', 'd'),
  wood: box('W', 'w', 's'),
  'wood-down': pressed('w', 's'),
  grass: box('G', 'g', 'l', 'e'),
  'grass-down': pressed('g', 'l', 'e'),
};

const ICONS: Record<string, string[]> = {
  undo: ['..c......', '.cc......', 'ccccccc..', '.cc....c.', '..c....c.', '.......c.', '...cccc..'],
  restart: ['c.....c', 'c....cc', 'c...ccc', 'c..cccc', 'c...ccc', 'c....cc', 'c.....c'],
  ccw: ['...cccc..', '..c....c.', '.c......c', 'ccc.....c', '.c......c', '........c', '..c....c.', '...cccc..'],
  cw: ['..cccc...', '.c....c..', 'c......c.', 'c.....ccc', 'c......c.', 'c........', '.c....c..', '..cccc...'],
  minus: ['ccccc'],
  plus: ['..c..', '..c..', 'ccccc', '..c..', '..c..'],
  close: ['c...c', '.c.c.', '..c..', '.c.c.', 'c...c'],
  help: ['.ccc.', 'c...c', '...c.', '..c..', '.....', '..c..'],
  // Sound on, and muted.
  soundOn: ['...c....', '..cc.c..', 'cccc..c.', 'cccc..c.', 'cccc..c.', '..cc.c..', '...c....'],
  soundOff: ['...c....', '..cc....', 'cccc.c.c', 'cccc..c.', 'cccc.c.c', '..cc....', '...c....'],
  // Editor tools: a patch of grass, and a patch with a hole cut in it.
  land: ['.eeeeeee.', 'eGGGGGGGe', 'eggggggge', 'eggggggge', 'ellllllle', '.eeeeeee.'],
  hole: ['.eeeeeee.', 'eGGeeeGGe', 'ege...ege', 'ege...ege', 'elleeelle', '.eeeeeee.'],
  // Playback speed: more chevrons, faster.
  speed1: ['c..', 'cc.', 'ccc', 'cc.', 'c..'],
  speed2: ['c...c..', 'cc..cc.', 'ccc.ccc', 'cc..cc.', 'c...c..'],
  speed3: ['c...c...c..', 'cc..cc..cc.', 'ccc.ccc.ccc', 'cc..cc..cc.', 'c...c...c..'],
};

const toUrl = (rows: string[], shadow = false): string => {
  const c = document.createElement('canvas');
  c.width = rows[0]!.length;
  c.height = rows.length + (shadow ? 1 : 0);
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  if (shadow) drawRows(ctx, rows, 0, 1, { c: COLORS.x! });
  drawRows(ctx, rows, 0, 0, COLORS);
  return c.toDataURL();
};

let cache: { icons: Record<string, string>; foes: string[]; out: string[]; you: string; rock: string } | null = null;

const build = () => {
  if (cache) return cache;
  const root = document.documentElement;
  for (const [name, rows] of Object.entries(SPRITES)) root.style.setProperty(`--img-${name}`, `url(${toUrl(rows)})`);
  cache = {
    icons: Object.fromEntries(Object.entries(ICONS).map(([k, rows]) => [k, toUrl(rows, true)])),
    foes: FOES.map((r) => slimeIcon(r, 'calm')),
    out: FOES.map(() => slimeIcon(GHOST, 'out')),
    you: slimeIcon(YOU, 'calm', true),
    rock: rockIcon(),
  };
  return cache;
};

export const icon = (name: keyof typeof ICONS | string): string => build().icons[name] ?? '';
export const iconSize = (name: string): [number, number] => {
  const rows = ICONS[name];
  return rows ? [rows[0]!.length, rows.length + 1] : [0, 0];
};
export const foePip = (i: number, out: boolean): string => (out ? build().out : build().foes)[i % FOES.length]!;
export const youPip = (): string => build().you;
const kindPips = new Map<string, string>();
/** Foe number i drawn as its kind: scowl, worried, paper crown or asleep. */
export const kindPip = (i: number, kind: FoeKind): string => {
  const key = `${i % FOES.length}:${kind}`;
  let url = kindPips.get(key);
  if (!url) {
    url = slimeIcon(FOES[i % FOES.length]!, 'calm', false, kindLook(kind));
    kindPips.set(key, url);
  }
  return url;
};
export const rockPip = (): string => build().rock;

export type Viewport = {
  /** CSS pixels per art pixel: a whole number of device pixels, so it may be a fraction here. */
  scale: number;
  /** Screen size in art pixels. */
  w: number;
  h: number;
  /** Controls sit beside the island instead of under it (wide windows). */
  wide: boolean;
};

/** Art pixels the side panel of controls takes in the wide layout. */
export const SIDE_W = 156;
/** Shortest the wide layout can be: the HUD and the island with its rock. */
const WIDE_MIN_H = 232;
/** Narrowest the stacked layout can be: the island plus a sliver each side. */
const MIN_W = 180;

const measure = (minH: number, allowWide: boolean): Viewport => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  // One art pixel is a whole number of the screen's own pixels, not of CSS pixels:
  // a phone 360 CSS pixels wide has 1080 real ones, and counting in CSS pixels would
  // draw everything at half the size it could be.
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  // Stacked: everything in one column at least MIN_W wide (the island is 176).
  // Wide: island left, controls right. Whichever lets the picture be drawn bigger wins.
  const tall = Math.floor(Math.min((w * dpr) / MIN_W, (h * dpr) / minH));
  const side = allowWide ? Math.floor(Math.min((w * dpr) / (192 + SIDE_W), (h * dpr) / WIDE_MIN_H)) : 0;
  const wide = side > tall;
  const scale = Math.max(1, wide ? side : tall) / dpr;
  return { scale, w: Math.ceil(w / scale), h: Math.ceil(h / scale), wide };
};

/**
 * Picks the largest scale (a whole number of device pixels) at which the picture fits,
 * publishes it as --px for the stylesheet, and installs the UI sprites.
 */
export const useViewport = (minH: number, allowWide = false): Viewport => {
  const [v, setV] = useState(() => {
    build();
    const first = measure(minH, allowWide);
    document.documentElement.style.setProperty('--px', `${first.scale}px`);
    return first;
  });
  useEffect(() => {
    const onResize = () => {
      const next = measure(minH, allowWide);
      document.documentElement.style.setProperty('--px', `${next.scale}px`);
      setV((prev) => (prev.scale === next.scale && prev.w === next.w && prev.h === next.h && prev.wide === next.wide ? prev : next));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minH, allowWide]);
  return v;
};
