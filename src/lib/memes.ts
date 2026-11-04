// Reaction "memes" shown faintly behind the board, picked by how close the latest guess is.
// Pictures: drop image files into public/memes/<mood>/ (found, hot, warm, cool, cold, lost, dirty).
// "near"    = latest guess ranked #2–#25 (extremely close)
// "letdown" = you had a decent guess (≤ 2,000) and the new one is much worse (cold, ≥ 5× your best)
// "dirty"   = the guess is a rude/NSFW word (see isDirty in puzzle.ts)
// They are picked up automatically at build time and used instead of the emoji below;
// any mood folder that is empty falls back to these emoji + captions.

export type Meme = { emoji: string; caption: string; img?: string };
export const MOODS = ["found", "near", "hot", "warm", "cool", "cold", "letdown", "lost", "dirty"] as const;
export type MemeMood = (typeof MOODS)[number];
export type MemeImages = Partial<Record<MemeMood, string[]>>;

export const MEMES: Record<MemeMood, Meme[]> = {
  found: [
    { emoji: "🗿", caption: "SIGMA" },
    { emoji: "👑", caption: "GIGACHAD MOVE" },
    { emoji: "🐐", caption: "THE GOAT" },
  ],
  near: [
    { emoji: "😳", caption: "SO CLOSE" },
    { emoji: "👀", caption: "it's right there" },
  ],
  hot: [
    { emoji: "🗿", caption: "sigma grindset" },
    { emoji: "😎", caption: "built different" },
    { emoji: "🔥", caption: "he's cooking" },
    { emoji: "🧠", caption: "big brain" },
  ],
  warm: [
    { emoji: "🤨", caption: "getting warmer…" },
    { emoji: "👀", caption: "oh? interesting" },
    { emoji: "🧐", caption: "on to something" },
  ],
  cool: [
    { emoji: "😐", caption: "bro…" },
    { emoji: "🥱", caption: "mid" },
    { emoji: "🤡", caption: "not quite chief" },
  ],
  cold: [
    { emoji: "💀", caption: "bro what" },
    { emoji: "😭", caption: "it's so over" },
    { emoji: "🫠", caption: "skill issue" },
    { emoji: "🗑️", caption: "L guess" },
  ],
  letdown: [
    { emoji: "😬", caption: "bro thought he had it" },
    { emoji: "🫥", caption: "that ain't it" },
  ],
  lost: [
    { emoji: "😔", caption: "it's over" },
    { emoji: "🪦", caption: "RIP" },
  ],
  dirty: [
    { emoji: "🤨", caption: "I'm watching you" },
    { emoji: "🧼", caption: "wash your mouth" },
  ],
};
