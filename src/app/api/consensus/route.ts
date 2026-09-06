import { NextResponse } from "next/server";
import { crossDeptConsensus } from "@/lib/engine/simulate";
import { ensureSeeded } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as { segmentId?: number };
    const result = await crossDeptConsensus(Number(body.segmentId));
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
