import Game from "@/components/Game";
import { PUZZLE_COUNT } from "@/lib/engine";

export default function Home() {
  return <Game count={PUZZLE_COUNT} />;
}
