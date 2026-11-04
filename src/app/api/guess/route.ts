import { NextResponse } from "next/server";
import { guess, validPuzzle, validSeed } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validPuzzle(body.id) || !validSeed(body.seed) || typeof body.word !== "string") {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  const result = guess(body.id, body.seed, body.word);
  return NextResponse.json(result, { status: "error" in result ? 422 : 200 });
}
