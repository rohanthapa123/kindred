"use client";

import { WORDIE_DEFAULT_LENGTH, WORDIE_LENGTHS, WORDIE_MAX_GUESSES } from "./wordie-rules";

export type WRow = { word: string; result: number[] };
export type WStatus = "playing" | "won" | "lost";
export type WRecord = { len: number; id: number; rows: WRow[]; status: WStatus; answer?: string; hard?: boolean };
export type WStats = { played: number; wins: number; streak: number; best: number; dist: number[] };

const P = "kindred:wordie:v1";

function get<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function set(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

export function loadSettings(): { len: number; hard: boolean } {
  const s = get<{ len?: number; hard?: boolean }>(`${P}:settings`, {});
  return {
    len: s.len && WORDIE_LENGTHS.includes(s.len) ? s.len : WORDIE_DEFAULT_LENGTH,
    hard: !!s.hard,
  };
}
export const saveSettings = (s: { len: number; hard: boolean }) => set(`${P}:settings`, s);

/** Which puzzle number the player is on for a given length. */
export const currentId = (len: number) => get<number>(`${P}:cur:${len}`, 0);
export const setCurrentId = (len: number, id: number) => set(`${P}:cur:${len}`, id);

export function loadRecord(len: number, id: number): WRecord {
  const r = get<WRecord | null>(`${P}:${len}:${id}`, null);
  if (r && Array.isArray(r.rows)) return { ...r, len, id };
  return { len, id, rows: [], status: "playing" };
}
export const saveRecord = (r: WRecord) => set(`${P}:${r.len}:${r.id}`, r);

const emptyStats = (): WStats => ({ played: 0, wins: 0, streak: 0, best: 0, dist: Array(WORDIE_MAX_GUESSES).fill(0) });
export const loadStats = (len: number) => ({ ...emptyStats(), ...get<Partial<WStats>>(`${P}:stats:${len}`, {}) });

/** Record a finished round (call exactly once per round). */
export function recordResult(len: number, won: boolean, guesses: number) {
  const s = loadStats(len);
  s.played++;
  if (won) {
    s.wins++;
    s.streak++;
    s.best = Math.max(s.best, s.streak);
    s.dist[guesses - 1] = (s.dist[guesses - 1] ?? 0) + 1;
  } else s.streak = 0;
  set(`${P}:stats:${len}`, s);
}
