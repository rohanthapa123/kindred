import "server-only";
import fs from "node:fs";
import path from "node:path";
import { FACTS, Fact } from "./hunch-facts";
import { HUNCH_PER_ROUND, HunchMode } from "./hunch-rules";
import { permutation } from "./shuffle";

/** Hand-written facts first, then the ones generated from datasets (scripts/build_hunch.py). */
function loadAll(): Fact[] {
  try {
    const gen = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "hunch-generated.json"), "utf8")) as Fact[];
    const ids = new Set(FACTS.map((f) => f.id));
    return [...FACTS, ...gen.filter((f) => !ids.has(f.id))];
  } catch {
    return FACTS;
  }
}
const ALL = loadAll();
const pools: Record<HunchMode, Fact[]> = {
  mixed: ALL,
  world: ALL.filter((f) => f.cat === "world"),
  nepal: ALL.filter((f) => f.cat === "nepal"),
  tech: ALL.filter((f) => f.cat === "tech"),
  culture: ALL.filter((f) => f.cat === "culture"),
};
const SALT: Record<HunchMode, number> = { mixed: 0x51, world: 0x77, nepal: 0x4e, tech: 0x74, culture: 0x63 };

export const roundCount = (mode: HunchMode) => Math.floor(pools[mode].length / HUNCH_PER_ROUND);
export const roundCounts = () =>
  Object.fromEntries((Object.keys(pools) as HunchMode[]).map((m) => [m, roundCount(m)])) as Record<HunchMode, number>;

export function validRound(mode: unknown, round: unknown): mode is HunchMode {
  return (
    typeof mode === "string" &&
    mode in pools &&
    typeof round === "number" &&
    Number.isInteger(round) &&
    round >= 0 &&
    round < roundCount(mode as HunchMode)
  );
}

/** The player's shuffled order decides which facts make up round N. */
function roundFacts(mode: HunchMode, round: number, seed: number): Fact[] {
  const pool = pools[mode];
  const order = permutation(pool.length, (seed ^ (SALT[mode] * 0x9e3779b1)) >>> 0);
  return Array.from({ length: HUNCH_PER_ROUND }, (_, i) => pool[order[round * HUNCH_PER_ROUND + i]]);
}

/** Questions without answers. */
export function hunchRound(mode: HunchMode, round: number, seed: number) {
  return roundFacts(mode, round, seed).map((f) => ({ q: f.q, unit: f.unit ?? "", cat: f.cat }));
}

/**
 * 0–100 points.
 * log: 100·e^(−1.5·|ln(guess/answer)|) → 10% off ≈ 87, 2× off ≈ 35, 10× off ≈ 3.
 * lin: 100·e^(−|guess−answer|/tol)     → off by one tolerance ≈ 37.
 */
export function score(f: Fact, guess: number): number {
  let s: number;
  if (f.kind === "lin") s = 100 * Math.exp(-Math.abs(guess - f.a) / (f.tol ?? 1));
  else if (guess <= 0 || f.a <= 0) s = guess === f.a ? 100 : 0;
  else s = 100 * Math.exp(-1.5 * Math.abs(Math.log(guess / f.a)));
  return Math.max(0, Math.min(100, Math.round(s)));
}

export function hunchAnswer(mode: HunchMode, round: number, seed: number, index: number, guess: number) {
  const f = roundFacts(mode, round, seed)[index];
  return { answer: f.a, unit: f.unit ?? "", score: score(f, guess), fact: f.fact, kind: f.kind ?? "log", tol: f.tol ?? null };
}
