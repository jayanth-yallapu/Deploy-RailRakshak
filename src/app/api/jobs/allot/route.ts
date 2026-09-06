import { NextResponse } from "next/server";
import { allotJob } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await allotJob({
      jobId: Number(body.jobId),
      teamLeader: String(body.teamLeader),
      windowStart: Number(body.windowStart ?? 30),
      windowEnd: Number(body.windowEnd ?? 210),
      isSuperBlock: !!body.isSuperBlock,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
