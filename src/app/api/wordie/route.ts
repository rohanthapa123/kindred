import { NextResponse } from "next/server";
import { validSeed } from "@/lib/shuffle";
import { validPuzzle, wordieGuess, wordieReveal } from "@/lib/wordie";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validPuzzle(body.len, body.id) || !validSeed(body.seed)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  if (body.action === "reveal") return NextResponse.json(wordieReveal(body.len, body.id, body.seed));
  if (typeof body.word !== "string") return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  const res = wordieGuess(body.len, body.id, body.seed, body.word);
  return NextResponse.json(res, { status: "error" in res ? 422 : 200 });
}
