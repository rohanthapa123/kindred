// Shared (client + server) puzzle rules. Never import secret data here.

export const TOO_COMMON = new Set(
  "the a an and or but is are was were be been being have has had do does did will would could should may might must can i you he she it we they".split(
    " ",
  ),
);

export const BLOCKED = new Set([
  "rape", "rapes", "retard", "retards", "nigga", "niggas", "nigger", "niggers",
  "faggot", "faggots", "negro", "coon", "kike", "spastic",
]);

/** Rude / NSFW words: still valid guesses, but they trigger the "dirty" reaction meme. */
export const NAUGHTY = new Set(
  ("fuck fucker fucking fucked fucks motherfucker shit shitty bullshit crap damn ass asshole arse bitch bitches " +
    "bastard dick dicks cock pussy cunt piss slut whore sex sexy porn porno boob boobs tits titties nipple nipples " +
    "penis vagina dildo horny nude naked orgasm cum wank wanker twat bollocks butt booty milf hentai blowjob anal " +
    "condom erection stripper boner jerk jizz screw thong").split(" "),
);

/** True for rude/NSFW words (and simple inflections like "fucking", "dicks") plus blocked slurs. */
export function isDirty(word: string): boolean {
  const w = word.toLowerCase();
  if (NAUGHTY.has(w) || BLOCKED.has(w)) return true;
  for (const suf of ["s", "es", "ed", "ing", "er", "y"]) {
    if (w.endsWith(suf) && NAUGHTY.has(w.slice(0, -suf.length))) return true;
  }
  return false;
}

export type Temp = "found" | "hot" | "warm" | "cool" | "cold";

export function temperature(rank: number): Temp {
  if (rank === 1) return "found";
  if (rank <= 300) return "hot";
  if (rank <= 2000) return "warm";
  if (rank <= 10000) return "cool";
  return "cold";
}

/** Closeness 0..1 for bar width (log scale so the top ranks spread out). */
export function closeness(rank: number, vocab = 100000): number {
  if (rank <= 1) return 1;
  return Math.max(0.02, 1 - Math.log(rank) / Math.log(vocab));
}

/**
 * Which rank a hint reveals, given what's already on the board.
 * No guesses yet → a mid-distance word. Far away → halve your best rank.
 * Already close (≤ 20) → the next unrevealed rank just above the answer.
 */
export function nextHintRank(bestRank: number | null, taken: Set<number>): number | null {
  const free = (r: number) => r >= 2 && !taken.has(r);
  if (bestRank === null) {
    for (let r = 1500; r < 5000; r++) if (free(r)) return r;
    return null;
  }
  if (bestRank <= 20) {
    for (let r = bestRank - 1; r >= 2; r--) if (free(r)) return r;
    for (let r = bestRank + 1; r <= 50; r++) if (free(r)) return r;
    return null;
  }
  const target = Math.max(2, Math.floor(bestRank / 2));
  for (let off = 0; off < 200; off++) {
    if (free(target - off)) return target - off;
    if (free(target + off) && target + off < bestRank) return target + off;
  }
  return null;
}
