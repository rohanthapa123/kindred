import "server-only";

/** Seeded permutation of 0..n-1 (mulberry32 PRNG + Fisher–Yates). Same (n, seed) → same order. */
const cache = new Map<string, Int32Array>();
export function permutation(n: number, seed: number): Int32Array {
  const key = `${n}:${seed}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const order = Int32Array.from({ length: n }, (_, i) => i);
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
  if (cache.size > 512) cache.delete(cache.keys().next().value!);
  cache.set(key, order);
  return order;
}

export function validSeed(seed: unknown): seed is number {
  return typeof seed === "number" && Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff;
}
