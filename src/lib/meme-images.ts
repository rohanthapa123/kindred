import "server-only";
import fs from "node:fs";
import path from "node:path";
import { MOODS, MemeImages } from "./memes";

/** Collect image files from public/memes/<mood>/ (read at build time; pages using it are static). */
export function memeImages(): MemeImages {
  const out: MemeImages = {};
  for (const mood of MOODS) {
    const dir = path.join(process.cwd(), "public", "memes", mood);
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.(png|jpe?g|webp|gif|avif)$/i.test(f))
        .sort();
      if (files.length) out[mood] = files.map((f) => `/memes/${mood}/${encodeURIComponent(f)}`);
    } catch {}
  }
  return out;
}
