/*
 * Playback speed. The simulation always runs at its own fixed tick, so the result of
 * a turn never depends on this; it only sets how fast the turn is shown.
 */

export type Speed = 'slow' | 'normal' | 'fast';

export type Pacing = {
  label: string;
  /** How many chevrons the speed button shows. */
  chevrons: 1 | 2 | 3;
  /** Simulation ticks shown per frame. 1 would be the sim's own speed. */
  sim: number;
  /** Frames of crouch before everyone launches, with the arrows still showing. */
  windup: number;
  /** Frames of pause after everything stops, before the next turn's arrows appear. */
  settle: number;
  /** Scales the freeze on a solid hit. */
  hitStop: number;
};

export const PACING: Record<Speed, Pacing> = {
  slow: { label: 'slow', chevrons: 1, sim: 0.24, windup: 18, settle: 28, hitStop: 1.2 },
  normal: { label: 'normal', chevrons: 2, sim: 0.42, windup: 16, settle: 26, hitStop: 1 },
  fast: { label: 'fast', chevrons: 3, sim: 0.85, windup: 8, settle: 14, hitStop: 0.4 },
};

/** Tapping the speed button steps normal, fast, slow, and round again. */
export const nextSpeed = (s: Speed): Speed => (s === 'normal' ? 'fast' : s === 'fast' ? 'slow' : 'normal');

const KEY = 'pushover:speed';

// Remembered per browser. Storage can be missing or blocked inside a webview, so
// every access is guarded and the game falls back to normal speed.
export const loadSpeed = (): Speed => {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'slow' || v === 'normal' || v === 'fast') return v;
  } catch {
    // no storage here
  }
  return 'normal';
};

export const saveSpeed = (s: Speed): void => {
  try {
    window.localStorage.setItem(KEY, s);
  } catch {
    // no storage here
  }
};
