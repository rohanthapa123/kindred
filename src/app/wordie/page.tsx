import type { Metadata } from "next";
import Wordie from "@/components/Wordie";
import { memeImages } from "@/lib/meme-images";
import { answerCounts } from "@/lib/wordie";

export const metadata: Metadata = {
  title: "Wordie — guess the word in six",
  description: "A word-guessing game: 4 to 8 letters, six tries, no on-screen keyboard.",
};

export default function WordiePage() {
  return <Wordie counts={answerCounts()} memeImages={memeImages()} />;
}
