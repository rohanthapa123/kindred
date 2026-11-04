import { NextResponse } from "next/server";
import { reveal, validPuzzle } from "@/lib/engine";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !validPuzzle(body.id)) {
    return NextResponse.json({ error: "BAD_REQUEST" }, { status: 400 });
  }
  return NextResponse.json(reveal(body.id));
}
