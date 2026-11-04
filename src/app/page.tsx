import fs from "node:fs";
import path from "node:path";
import Game from "@/components/Game";
import { PUZZLE_COUNT } from "@/lib/engine";
import { MOODS, MemeImages } from "@/lib/memes";

/** Collect image files from public/memes/<mood>/ (read at build time; the page is static). */
function memeImages(): MemeImages {
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

export default function Home() {
  return <Game count={PUZZLE_COUNT} memeImages={memeImages()} />;
}
