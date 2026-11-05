"use client";

import { HUNCH_CATS, HunchMode } from "./hunch-rules";

export type HAnswer = { guess: number; answer: number; score: number; unit: string; fact: string; kind: string; tol: number | null };
export type HRecord = { mode: HunchMode; round: number; answers: HAnswer[] };
export type HStats = { rounds: number; total: number; best: number; bullseyes: number };

const P = "kindred:hunch:v1";
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

export function loadMode(): HunchMode {
  const m = get<string>(`${P}:mode`, "mixed");
  return (HUNCH_CATS as readonly string[]).includes(m) ? (m as HunchMode) : "mixed";
}
export const saveMode = (m: HunchMode) => set(`${P}:mode`, m);
export const currentRound = (m: HunchMode) => get<number>(`${P}:cur:${m}`, 0);
export const setCurrentRound = (m: HunchMode, r: number) => set(`${P}:cur:${m}`, r);
export function loadRecord(mode: HunchMode, round: number): HRecord {
  const r = get<HRecord | null>(`${P}:${mode}:${round}`, null);
  return r && Array.isArray(r.answers) ? { ...r, mode, round } : { mode, round, answers: [] };
}
export const saveRecord = (r: HRecord) => set(`${P}:${r.mode}:${r.round}`, r);
export const loadStats = (): HStats => ({ rounds: 0, total: 0, best: 0, bullseyes: 0, ...get<Partial<HStats>>(`${P}:stats`, {}) });
export function recordRound(r: HRecord) {
  const s = loadStats();
  const total = r.answers.reduce((t, a) => t + a.score, 0);
  s.rounds++;
  s.total += total;
  s.best = Math.max(s.best, total);
  s.bullseyes += r.answers.filter((a) => a.score >= 95).length;
  set(`${P}:stats`, s);
}
