import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SECRET_WORDS } from "./secrets";
import { BLOCKED, TOO_COMMON } from "./puzzle";

const DIM = 100;

type Data = { vocab: string[]; index: Map<string, number>; vectors: Int8Array };
let data: Data | null = null;
const rankCache = new Map<string, { ranks: Int32Array; order: Int32Array }>();

function load(): Data {
  if (data) return data;
  const dir = path.join(process.cwd(), "data");
  const vocab = fs.readFileSync(path.join(dir, "vocab.txt"), "utf8").split("\n");
  const buf = fs.readFileSync(path.join(dir, "vectors.bin"));
  const vectors = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const index = new Map<string, number>();
  vocab.forEach((w, i) => index.set(w, i));
  data = { vocab, index, vectors };
  return data;
}

/**
 * Each player (device) has its own random seed, so puzzle #N is a different word for every player.
 * The seed picks a full permutation of the answer pool: every word appears exactly once per player.
 */
const orderCache = new Map<number, Int32Array>();
function orderFor(seed: number): Int32Array {
  const cached = orderCache.get(seed);
  if (cached) return cached;
  const n = SECRET_WORDS.length;
  const order = Int32Array.from({ length: n }, (_, i) => i);
  // mulberry32 PRNG + Fisher–Yates
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (orderCache.size > 256) orderCache.delete(orderCache.keys().next().value!);
  orderCache.set(seed, order);
  return order;
}

function secretFor(id: number, seed: number): string {
  return SECRET_WORDS[orderFor(seed)[id]];
}

function ranksFor(id: number, seed: number) {
  const secret = secretFor(id, seed);
  const cached = rankCache.get(secret);
  if (cached) return cached;
  const { vocab, index, vectors } = load();
  const t = index.get(secret);
  if (t === undefined) throw new Error(`secret "${secret}" missing from vocab`);
  const n = vocab.length;
  const sims = new Float32Array(n);
  const to = t * DIM;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * DIM;
    for (let d = 0; d < DIM; d++) s += vectors[o + d] * vectors[to + d];
    sims[i] = s;
  }
  sims[t] = Infinity; // the secret is always rank 1
  const order = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => sims[b] - sims[a]);
  const ranks = new Int32Array(n);
  order.forEach((wi, r) => (ranks[wi] = r + 1));
  const entry = { ranks, order };
  if (rankCache.size > 32) rankCache.delete(rankCache.keys().next().value!);
  rankCache.set(secret, entry);
  return entry;
}

export type GuessError =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID"
  | "TOO_COMMON"
  | "DISALLOWED"
  | "NOT_FOUND";

/** Normalise simple inflections (plurals, -ing, -ed) back to a word we rank. */
function lemma(word: string, index: Map<string, number>): string | null {
  if (index.has(word)) return word;
  const tries: string[] = [];
  if (word.endsWith("ies")) tries.push(word.slice(0, -3) + "y");
  if (word.endsWith("ves")) tries.push(word.slice(0, -3) + "f", word.slice(0, -3) + "fe");
  if (word.endsWith("es")) tries.push(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss")) tries.push(word.slice(0, -1));
  if (word.endsWith("ing")) tries.push(word.slice(0, -3), word.slice(0, -3) + "e");
  if (word.endsWith("ed")) tries.push(word.slice(0, -2), word.slice(0, -1));
  for (const t of tries) if (t.length >= 2 && index.has(t)) return t;
  return null;
}

export function vocabSize() {
  return load().vocab.length;
}

export function guess(id: number, seed: number, raw: string): { word: string; rank: number } | { error: GuessError } {
  const word = raw.trim().toLowerCase();
  if (word.length < 2) return { error: "TOO_SHORT" };
  if (word.length > 20) return { error: "TOO_LONG" };
  if (!/^[a-z]+$/.test(word)) return { error: "INVALID" };
  if (TOO_COMMON.has(word)) return { error: "TOO_COMMON" };
  if (BLOCKED.has(word)) return { error: "DISALLOWED" };
  const { index } = load();
  const w = lemma(word, index);
  if (!w) return { error: "NOT_FOUND" };
  return { word: w, rank: ranksFor(id, seed).ranks[index.get(w)!] };
}

export function hint(id: number, seed: number, rank: number): { word: string; rank: number } {
  const { vocab } = load();
  const r = Math.max(2, Math.min(vocab.length, Math.floor(rank)));
  return { word: vocab[ranksFor(id, seed).order[r - 1]], rank: r };
}

export function reveal(id: number, seed: number, top = 100): { word: string; closest: { word: string; rank: number }[] } {
  const { vocab } = load();
  const { order } = ranksFor(id, seed);
  const closest = Array.from(order.slice(0, top), (wi, i) => ({ word: vocab[wi], rank: i + 1 }));
  return { word: closest[0].word, closest };
}

export const PUZZLE_COUNT = SECRET_WORDS.length;

export function validPuzzle(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < PUZZLE_COUNT;
}

export function validSeed(seed: unknown): seed is number {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}
