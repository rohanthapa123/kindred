import type { Metadata } from "next";
import Hunch from "@/components/Hunch";
import { roundCounts } from "@/lib/hunch";
import { memeImages } from "@/lib/meme-images";

export const metadata: Metadata = {
  title: "Hunch — guess the number",
  description: "Five number questions a round: world facts, Nepal and tech. The closer your guess, the higher your score.",
};

export default function HunchPage() {
  return <Hunch counts={roundCounts()} memeImages={memeImages()} />;
}
