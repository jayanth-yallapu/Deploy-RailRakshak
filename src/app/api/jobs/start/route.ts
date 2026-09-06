import { NextResponse } from "next/server";
import { startJob } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    await startJob({ jobId: Number(body.jobId), photoData: body.photoData ? String(body.photoData) : undefined });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
