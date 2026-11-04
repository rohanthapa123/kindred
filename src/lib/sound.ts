"use client";

// Tiny synthesised sound kit (Web Audio, no files). Every sound is a few short oscillator notes.

const MUTE_KEY = "kindred:v1:muted";
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted: boolean | null = null;

export function isMuted(): boolean {
  if (muted === null) {
    try {
      muted = window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      muted = false;
    }
  }
  return muted;
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {}
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined" || isMuted()) return null;
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return { ctx, out: master! };
  } catch {
    return null;
  }
}

type Note = { f: number; at?: number; dur?: number; type?: OscillatorType; vol?: number; slide?: number };

function play(notes: Note[]) {
  const a = audio();
  if (!a) return;
  const now = a.ctx.currentTime;
  for (const n of notes) {
    const t = now + (n.at ?? 0);
    const dur = n.dur ?? 0.12;
    const osc = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.f, t);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(n.slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(n.vol ?? 0.6, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
}

export const sfx = {
  /** soft click for typing / buttons */
  tap: () => play([{ f: 1400, dur: 0.035, type: "triangle", vol: 0.12 }]),
  /** a guess landed; pitch rises the closer it is (closeness 0..1) */
  guess: (closeness: number) => {
    const base = 220 + closeness * 660;
    play([
      { f: base, dur: 0.14, type: "triangle", vol: 0.45 },
      { f: base * 1.5, at: 0.06, dur: 0.16, type: "sine", vol: 0.3 },
    ]);
  },
  error: () =>
    play([
      { f: 190, dur: 0.09, type: "square", vol: 0.12 },
      { f: 150, at: 0.09, dur: 0.12, type: "square", vol: 0.12 },
    ]),
  hint: () =>
    play([
      { f: 880, dur: 0.18, vol: 0.35 },
      { f: 1320, at: 0.08, dur: 0.22, vol: 0.28 },
      { f: 1760, at: 0.16, dur: 0.3, vol: 0.18 },
    ]),
  win: () =>
    play(
      [523.25, 659.25, 783.99, 1046.5, 1318.5].map((f, i) => ({
        f,
        at: i * 0.09,
        dur: 0.45,
        type: "triangle" as OscillatorType,
        vol: 0.4,
      })),
    ),
  lose: () =>
    play([
      { f: 392, dur: 0.25, type: "triangle", vol: 0.35 },
      { f: 311, at: 0.18, dur: 0.3, type: "triangle", vol: 0.3 },
      { f: 233, at: 0.36, dur: 0.55, type: "triangle", vol: 0.28, slide: 196 },
    ]),
  open: () => play([{ f: 520, dur: 0.12, vol: 0.18, slide: 780 }]),
  close: () => play([{ f: 700, dur: 0.1, vol: 0.14, slide: 460 }]),
  /** one tile flipping over: state 2 = right spot, 1 = elsewhere, 0 = absent; i = tile index */
  flip: (state: number, i: number) =>
    play([
      {
        f: state === 2 ? 660 + i * 70 : state === 1 ? 520 + i * 40 : 300,
        dur: state === 0 ? 0.07 : 0.11,
        type: state === 0 ? "sine" : "triangle",
        vol: state === 0 ? 0.16 : 0.3,
      },
    ]),
  /** rising drumroll of soft ticks lasting `ms` (anticipation before the reveal) */
  charge: (ms: number) => {
    const n = Math.max(3, Math.round(ms / 45));
    play(
      Array.from({ length: n }, (_, i) => ({
        f: 180 + (i / n) * 260,
        at: (i / n) * (ms / 1000),
        dur: 0.04,
        type: "triangle" as OscillatorType,
        vol: 0.06 + (i / n) * 0.12,
      })),
    );
  },
  /** suspense: a slow, quiet heartbeat while the last tile is held back */
  tense: (ms: number) =>
    play([
      { f: 110, dur: 0.12, type: "sine", vol: 0.35 },
      { f: 104, at: 0.16, dur: 0.14, type: "sine", vol: 0.3 },
      { f: 120, at: Math.max(0.35, ms / 1000 - 0.2), dur: 0.12, type: "sine", vol: 0.32 },
    ]),
  /** little sparkle when a tile lands green */
  sparkle: (i: number) =>
    play([
      { f: 1568 + i * 90, dur: 0.12, type: "sine", vol: 0.12 },
      { f: 2093 + i * 90, at: 0.05, dur: 0.16, type: "sine", vol: 0.08 },
    ]),
  back: () => play([{ f: 900, dur: 0.03, type: "triangle", vol: 0.08 }]),
  swoosh: () => play([{ f: 300, dur: 0.35, type: "sine", vol: 0.2, slide: 900 }]),
};
