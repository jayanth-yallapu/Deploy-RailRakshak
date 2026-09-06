import { NextResponse } from "next/server";
import { setPlanStatus } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { mode?: string; reason?: string; note?: string };
    const mode = body.mode === "VETOED" ? "VETOED" : body.mode === "APPROVED" ? "APPROVED" : "PROPOSED";
    await setPlanStatus(mode, body.reason, body.note);
    return NextResponse.json({ ok: true, planStatus: mode });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
