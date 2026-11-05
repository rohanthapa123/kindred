import { NextResponse } from "next/server";
import { HUNCH_PER_ROUND } from "@/lib/hunch-rules";
import { hunchAnswer, hunchRound, validRound } from "@/lib/hunch";
import { validSeed } from "@/lib/shuffle";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validRound(body.mode, body.round) || !validSeed(body.seed)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  if (body.action === "round") return NextResponse.json({ questions: hunchRound(body.mode, body.round, body.seed) });
  const i = body.index;
  if (!Number.isInteger(i) || i < 0 || i >= HUNCH_PER_ROUND || typeof body.guess !== "number" || !Number.isFinite(body.guess)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json(hunchAnswer(body.mode, body.round, body.seed, i, body.guess));
}
