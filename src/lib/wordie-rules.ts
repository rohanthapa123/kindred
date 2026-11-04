// Shared (client + server) Wordie rules. No word data here.
export const WORDIE_LENGTHS = [4, 5, 6, 7, 8];
export const WORDIE_DEFAULT_LENGTH = 5;
export const WORDIE_MAX_GUESSES = 6;

/** Hard mode: every revealed hint must be used in later guesses. Returns an error message or null. */
export function hardModeError(guess: string, rows: { word: string; result: number[] }[]): string | null {
  const ord = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
  for (const { word, result } of rows) {
    for (let i = 0; i < word.length; i++) {
      if (result[i] === 2 && guess[i] !== word[i]) return `${ord(i + 1)} letter must be ${word[i].toUpperCase()}`;
    }
    const need = new Map<string, number>();
    for (let i = 0; i < word.length; i++) if (result[i] > 0) need.set(word[i], (need.get(word[i]) ?? 0) + 1);
    for (const [ch, n] of need) {
      const have = [...guess].filter((c) => c === ch).length;
      if (have < n) return `Guess must contain ${ch.toUpperCase()}`;
    }
  }
  return null;
}
