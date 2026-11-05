// Shared (client + server) Hunch rules.
export const HUNCH_CATS = ["mixed", "world", "nepal", "tech", "culture"] as const;
export type HunchMode = (typeof HUNCH_CATS)[number];
export const HUNCH_PER_ROUND = 5;
export const HUNCH_LABEL: Record<HunchMode, string> = { mixed: "Mixed", world: "World", nepal: "Nepal", tech: "Tech", culture: "Culture" };

/** Parse "1,234", "1.5k", "2m", "3.2 billion", "-40" into a number (null if unreadable). */
export function parseGuess(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/[, _]/g, "");
  const m = s.match(/^(-?\d*\.?\d+)(k|thousand|m|mn|million|b|bn|billion|t|trillion)?$/);
  if (!m) return null;
  const mult: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
  const n = parseFloat(m[1]) * (m[2] ? mult[m[2]] : 1);
  return Number.isFinite(n) ? n : null;
}

/** Thousands separators, and up to 3 decimals (trailing zeros dropped) below 100,000: 8848.86 → "8,848.86". */
export function formatNum(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) >= 100000 ? 0 : 3 });
}
