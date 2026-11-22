import { useSyncExternalStore } from 'react';

/*
 * Sound effects, synthesised with Web Audio: square and triangle blips and bursts of
 * filtered noise, in keeping with the pixel art. No audio files to load.
 *
 * Browsers only allow sound after the player has touched the page, so the audio
 * context is created on the first tap (unlockAudio). Mute is remembered per browser.
 */

const KEY = 'pushover:muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

const loadMuted = (): boolean => {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};
let muted = loadMuted();
const listeners = new Set<() => void>();

export const isMuted = (): boolean => muted;

export const setMuted = (value: boolean): void => {
  muted = value;
  try {
    window.localStorage.setItem(KEY, value ? '1' : '0');
  } catch {
    // no storage here
  }
  if (master && ctx) master.gain.setTargetAtTime(value ? 0 : 1, ctx.currentTime, 0.01);
  listeners.forEach((fn) => fn());
};

/** React hook: the current mute state, re-rendering when it changes. */
export const useMuted = (): boolean =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => muted
  );

/** Call from a tap or key press: starts (or resumes) audio. Safe to call every time. */
export const unlockAudio = (): void => {
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined = window.AudioContext ?? Reflect.get(window, 'webkitAudioContext');
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
};

type Wave = 'square' | 'triangle' | 'sine' | 'sawtooth';

/** One note: a pitch (optionally gliding to another) with a quick attack and a fade. */
const tone = (wave: Wave, from: number, to: number, dur: number, vol: number, delay = 0) => {
  if (!ctx || !master || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, t0);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
};

/** A puff of noise through a low-pass filter. */
const noise = (dur: number, vol: number, cutoff: number, delay = 0) => {
  if (!ctx || !master || muted) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, cutoff / 4), t0 + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  src.start(t0, Math.random() * 0.5);
  src.stop(t0 + dur + 0.02);
};

// Stops the same sound stacking up when many things happen in one frame.
const last: Record<string, number> = {};
const ready = (name: string, gapMs: number): boolean => {
  const now = performance.now();
  if (now - (last[name] ?? 0) < gapMs) return false;
  last[name] = now;
  return true;
};

const NOTE = { C5: 523, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047, E6: 1319, G4: 392, Eb4: 311, C4: 262 };

export const sfx = {
  /** A button press. */
  click: () => ready('click', 40) && tone('square', 620, 480, 0.05, 0.035),
  /** The aim changed by a notch. */
  tick: () => ready('tick', 35) && tone('triangle', 900, 900, 0.025, 0.03),
  /** Everyone pushes off; a harder push is a higher swoop. */
  launch: (power: number) => {
    if (!ready('launch', 80)) return;
    tone('triangle', 180, 320 + power * 50, 0.16, 0.08);
    noise(0.14, 0.05, 1800);
  },
  /** Two slimes bump: a rubbery boing, louder for a harder hit. */
  bump: (force: number) => {
    if (!ready('bump', 45)) return;
    const f = Math.min(1, force / 2.5);
    tone('sine', 260 + f * 160, 110, 0.16, 0.07 + f * 0.1);
    noise(0.05, 0.03 + f * 0.04, 2400);
  },
  /** A slime bounces off a boulder: a duller knock. */
  bonk: (force: number) => {
    if (!ready('bonk', 45)) return;
    const f = Math.min(1, force / 2.5);
    tone('triangle', 150, 70, 0.1, 0.09 + f * 0.08);
    noise(0.06, 0.05 + f * 0.04, 700);
  },
  /** Someone goes over the edge: a falling whistle. */
  fall: () => ready('fall', 60) && tone('sine', 880, 180, 0.55, 0.05),
  /** Into the clouds. */
  poof: () => ready('poof', 60) && noise(0.3, 0.1, 900),
  /** A foe is out: a two-note chime that climbs with each one. */
  score: (count: number) => {
    const base = NOTE.C5 * Math.pow(1.122, Math.min(8, Math.max(0, count - 1)));
    tone('square', base, base, 0.09, 0.05);
    tone('square', base * 1.5, base * 1.5, 0.14, 0.05, 0.08);
  },
  /** You fell off. */
  oops: () => {
    tone('square', NOTE.G4, NOTE.G4, 0.14, 0.05);
    tone('square', NOTE.Eb4, NOTE.Eb4, 0.14, 0.05, 0.14);
    tone('square', NOTE.C4, NOTE.C4 * 0.94, 0.3, 0.05, 0.28);
  },
  /** Run over, everyone pushed off. */
  sweep: () => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6].forEach((n, i) => tone('square', n, n, 0.14, 0.05, i * 0.085)),
  /** Run over, some pushed off. */
  done: () => [NOTE.C5, NOTE.E5, NOTE.G5].forEach((n, i) => tone('square', n, n, 0.14, 0.045, i * 0.1)),
  /** Editor: something placed. */
  place: () => ready('place', 40) && tone('triangle', 520, 700, 0.07, 0.06),
  /** Editor: something removed or cut away. */
  cut: () => ready('cut', 40) && noise(0.07, 0.05, 1500),
};
