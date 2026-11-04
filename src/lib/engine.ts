import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SECRET_WORDS } from "./secrets";
import { BLOCKED, TOO_COMMON } from "./puzzle";

const DIM = 100;

type Data = { vocab: string[]; index: Map<string, number>; vectors: Int8Array };
let data: Data | null = null;
const rankCache = new Map<number, { ranks: Int32Array; order: Int32Array }>();

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

/** Deterministic shuffle so consecutive puzzles are not neighbours in the list. */
function secretFor(id: number): string {
  const n = SECRET_WORDS.length;
  // multiplicative stride coprime with n walks the whole list before repeating
  let stride = 7919 % n;
  while (gcd(stride, n) !== 1) stride++;
  return SECRET_WORDS[(id * stride + 13) % n];
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function ranksFor(id: number) {
  const cached = rankCache.get(id);
  if (cached) return cached;
  const { vocab, index, vectors } = load();
  const secret = secretFor(id);
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
  rankCache.set(id, entry);
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

export function guess(id: number, raw: string): { word: string; rank: number } | { error: GuessError } {
  const word = raw.trim().toLowerCase();
  if (word.length < 2) return { error: "TOO_SHORT" };
  if (word.length > 20) return { error: "TOO_LONG" };
  if (!/^[a-z]+$/.test(word)) return { error: "INVALID" };
  if (TOO_COMMON.has(word)) return { error: "TOO_COMMON" };
  if (BLOCKED.has(word)) return { error: "DISALLOWED" };
  const { index } = load();
  const w = lemma(word, index);
  if (!w) return { error: "NOT_FOUND" };
  return { word: w, rank: ranksFor(id).ranks[index.get(w)!] };
}

export function hint(id: number, rank: number): { word: string; rank: number } {
  const { vocab } = load();
  const r = Math.max(2, Math.min(vocab.length, Math.floor(rank)));
  return { word: vocab[ranksFor(id).order[r - 1]], rank: r };
}

export function reveal(id: number, top = 100): { word: string; closest: { word: string; rank: number }[] } {
  const { vocab } = load();
  const { order } = ranksFor(id);
  const closest = Array.from(order.slice(0, top), (wi, i) => ({ word: vocab[wi], rank: i + 1 }));
  return { word: closest[0].word, closest };
}

export const PUZZLE_COUNT = SECRET_WORDS.length;

export function validPuzzle(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < PUZZLE_COUNT;
}
