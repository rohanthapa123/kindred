import Game from "@/components/Game";
import { PUZZLE_COUNT } from "@/lib/engine";
import { memeImages } from "@/lib/meme-images";

export default function Home() {
  return <Game count={PUZZLE_COUNT} memeImages={memeImages()} />;
}
