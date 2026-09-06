import { NextResponse } from "next/server";
import { reportJob } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = await reportJob({
      title: String(body.title ?? "Manual defect report"),
      segmentId: Number(body.segmentId),
      department: String(body.department ?? "ENG"),
      note: body.note ? String(body.note) : "",
      photoData: body.photoData ? String(body.photoData) : undefined,
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
