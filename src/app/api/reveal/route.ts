import { NextResponse } from "next/server";
import { reveal, validPuzzle, validSeed } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validPuzzle(body.id) || !validSeed(body.seed)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json(reveal(body.id, body.seed));
}
