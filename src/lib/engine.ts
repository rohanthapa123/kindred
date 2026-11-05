import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SECRET_WORDS } from "./secrets";
import { permutation } from "./shuffle";
export { validSeed } from "./shuffle";
import { BLOCKED, TOO_COMMON } from "./puzzle";

const DIM = 100;

/**
 * famOf[i] = the "family" word i belongs to. A regular plural and its singular (headphones / headphone)
 * are one family and always share a rank, so guessing either form scores the same.
 */
type Data = { vocab: string[]; index: Map<string, number>; vectors: Int8Array; famOf: Int32Array };
let data: Data | null = null;
const rankCache = new Map<string, { ranks: Int32Array; order: Int32Array; rep: Int32Array }>();

// plural/singular pairs with different meanings: never merge these
const KEEP_APART = new Set(["news", "means", "glasses", "arms", "customs", "goods", "odds", "physics", "series"]);
const MERGE_MIN_COS = 0.4; // measured: real pairs ≥ 0.44 (berries/berry), false ones like lens/len ≈ 0.01

/** Candidate singulars for a regular plural (cats→cat, boxes→box, berries→berry, wolves→wolf). */
function singulars(w: string): string[] {
  const t: string[] = [];
  if (w.length > 4 && w.endsWith("ies")) t.push(w.slice(0, -3) + "y");
  if (w.endsWith("ves")) t.push(w.slice(0, -3) + "f", w.slice(0, -3) + "fe");
  if (/(s|x|z|ch|sh)es$/.test(w)) t.push(w.slice(0, -2));
  if (w.endsWith("s") && !/(ss|us|is)$/.test(w)) t.push(w.slice(0, -1));
  return t.filter((b) => b.length >= 3);
}

function cosine(v: Int8Array, a: number, b: number): number {
  let s = 0, x = 0, y = 0;
  for (let d = 0; d < DIM; d++) {
    const p = v[a * DIM + d], q = v[b * DIM + d];
    s += p * q;
    x += p * p;
    y += q * q;
  }
  return s / Math.sqrt(x * y);
}

function load(): Data {
  if (data) return data;
  const dir = path.join(process.cwd(), "data");
  const vocab = fs.readFileSync(path.join(dir, "vocab.txt"), "utf8").split("\n");
  const buf = fs.readFileSync(path.join(dir, "vectors.bin"));
  const vectors = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const index = new Map<string, number>();
  vocab.forEach((w, i) => index.set(w, i));
  const famOf = Int32Array.from({ length: vocab.length }, (_, i) => i);
  vocab.forEach((w, i) => {
    if (KEEP_APART.has(w)) return;
    for (const base of singulars(w)) {
      const b = index.get(base);
      if (b !== undefined && cosine(vectors, i, b) >= MERGE_MIN_COS) {
        famOf[i] = b;
        break;
      }
    }
  });
  for (let i = 0; i < famOf.length; i++) while (famOf[famOf[i]] !== famOf[i]) famOf[i] = famOf[famOf[i]]; // no chains
  data = { vocab, index, vectors, famOf };
  return data;
}

/**
 * Each player (device) has its own random seed, so puzzle #N is a different word for every player.
 * The seed picks a full permutation of the answer pool: every word appears exactly once per player.
 */
function secretFor(id: number, seed: number): string {
  return SECRET_WORDS[permutation(SECRET_WORDS.length, seed)[id]];
}

function ranksFor(id: number, seed: number) {
  const secret = secretFor(id, seed);
  const cached = rankCache.get(secret);
  if (cached) return cached;
  const { vocab, index, vectors, famOf } = load();
  const t = index.get(secret);
  if (t === undefined) throw new Error(`secret "${secret}" missing from vocab`);
  const n = vocab.length;
  // a family scores as its closest member
  const famSim = new Float32Array(n).fill(-Infinity);
  const to = t * DIM;
  for (let i = 0; i < n; i++) {
    let s = 0;
    const o = i * DIM;
    for (let d = 0; d < DIM; d++) s += vectors[o + d] * vectors[to + d];
    const f = famOf[i];
    if (s > famSim[f]) famSim[f] = s;
  }
  famSim[famOf[t]] = Infinity; // the secret (and its singular/plural) is always rank 1
  const fams: number[] = [];
  for (let i = 0; i < n; i++) if (famOf[i] === i) fams.push(i);
  const order = Int32Array.from(fams).sort((a, b) => famSim[b] - famSim[a]); // ranked families
  const famRank = new Int32Array(n);
  order.forEach((f, r) => (famRank[f] = r + 1));
  const ranks = new Int32Array(n);
  for (let i = 0; i < n; i++) ranks[i] = famRank[famOf[i]];
  // word shown for a family in hints / the closest list: the secret itself for rank 1, else the singular
  const rep = Int32Array.from(order);
  rep[0] = t;
  const entry = { ranks, order, rep };
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
  const { rep } = ranksFor(id, seed);
  const r = Math.max(2, Math.min(rep.length, Math.floor(rank)));
  return { word: vocab[rep[r - 1]], rank: r };
}

export function reveal(id: number, seed: number, top = 100): { word: string; closest: { word: string; rank: number }[] } {
  const { vocab } = load();
  const { rep } = ranksFor(id, seed);
  const closest = Array.from(rep.slice(0, top), (wi, i) => ({ word: vocab[wi], rank: i + 1 }));
  return { word: closest[0].word, closest };
}

export const PUZZLE_COUNT = SECRET_WORDS.length;

export function validPuzzle(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id >= 0 && id < PUZZLE_COUNT;
}

