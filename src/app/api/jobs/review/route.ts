import { NextResponse } from "next/server";
import { reviewJob } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await reviewJob({ jobId: Number(body.jobId), accept: !!body.accept, reason: body.reason ? String(body.reason) : undefined });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
