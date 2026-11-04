"use client";

export type Entry = { word: string; rank: number; hint?: boolean };
export type Status = "playing" | "won" | "lost";
export type PuzzleRecord = { id: number; entries: Entry[]; status: Status; finishedAt?: number };

// v4: puzzle order is now shuffled per device, so v3 boards no longer match their puzzle numbers.
const KEY = (id: number) => `kindred:v4:puzzle:${id}`;
const SEED_KEY = "kindred:v4:seed";

let memSeed: number | null = null;
/** Per-device random seed that decides this player's word order. Created once, then reused. */
export function playerSeed(): number {
  if (memSeed !== null) return memSeed;
  const stored = Number(safeGet(SEED_KEY));
  if (safeGet(SEED_KEY) !== null && Number.isInteger(stored) && stored >= 0 && stored <= 0xffffffff) {
    memSeed = stored;
  } else {
    memSeed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      window.localStorage.setItem(SEED_KEY, String(memSeed));
    } catch {}
  }
  return memSeed;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadPuzzle(id: number): PuzzleRecord {
  const raw = safeGet(KEY(id));
  if (raw) {
    try {
      const rec = JSON.parse(raw) as PuzzleRecord;
      if (Array.isArray(rec.entries)) return { ...rec, id };
    } catch {}
  }
  return { id, entries: [], status: "playing" };
}

export function savePuzzle(rec: PuzzleRecord) {
  try {
    window.localStorage.setItem(KEY(rec.id), JSON.stringify(rec));
  } catch {}
}

export function allPuzzles(count: number): PuzzleRecord[] {
  const out: PuzzleRecord[] = [];
  for (let i = 0; i < count; i++) {
    const raw = safeGet(KEY(i));
    if (!raw) continue;
    try {
      out.push({ ...JSON.parse(raw), id: i });
    } catch {}
  }
  return out;
}

/** The next puzzle to play: first unfinished one after `from`, wrapping around. Null if all are finished. */
export function nextUnfinished(count: number, from: number): number | null {
  const finished = new Set(allPuzzles(count).filter((r) => r.status !== "playing").map((r) => r.id));
  for (let k = 1; k <= count; k++) {
    const id = (from + k) % count;
    if (!finished.has(id)) return id;
  }
  return null;
}

export const guessCount = (r: PuzzleRecord) => r.entries.filter((e) => !e.hint).length;
export const hintCount = (r: PuzzleRecord) => r.entries.filter((e) => e.hint).length;

export const BUCKETS = [
  { label: "1–10", max: 10 },
  { label: "11–20", max: 20 },
  { label: "21–35", max: 35 },
  { label: "36–60", max: 60 },
  { label: "61–100", max: 100 },
  { label: "100+", max: Infinity },
];

export function stats(count: number) {
  const done = allPuzzles(count)
    .filter((r) => r.status !== "playing")
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  const won = done.filter((r) => r.status === "won");
  const dist = BUCKETS.map((b, i) => ({
    label: b.label,
    count: won.filter((r) => {
      const n = guessCount(r) + hintCount(r);
      return n <= b.max && (i === 0 || n > BUCKETS[i - 1].max);
    }).length,
  }));
  dist.push({ label: "Gave up", count: done.length - won.length });

  // streaks = consecutive wins in the order rounds were finished
  let run = 0;
  let best = 0;
  for (const r of done) {
    run = r.status === "won" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  const avg = won.length ? won.reduce((s, r) => s + guessCount(r) + hintCount(r), 0) / won.length : 0;
  return {
    played: done.length,
    winPct: done.length ? Math.round((won.length / done.length) * 100) : 0,
    current: run,
    best,
    avg: Math.round(avg * 10) / 10,
    dist,
  };
}
