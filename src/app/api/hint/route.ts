import { NextResponse } from "next/server";
import { hint, validPuzzle, validSeed } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validPuzzle(body.id) || !validSeed(body.seed) || typeof body.rank !== "number" || body.rank < 2) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json(hint(body.id, body.seed, body.rank));
}
