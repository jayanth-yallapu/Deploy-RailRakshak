import { NextResponse } from "next/server";
import { whatIf } from "@/lib/engine/simulate";
import { ensureSeeded } from "@/lib/engine/seed";
import type { WhatIfRequest } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json()) as Partial<WhatIfRequest>;
    const result = await whatIf({
      segmentId: Number(body.segmentId),
      durationH: Number(body.durationH) || 2,
      startMin: Number(body.startMin) || 60,
      superBlock: !!body.superBlock,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
