import { NextResponse } from "next/server";
import { getJobs } from "@/lib/engine/jobs";
import { ensureSeeded } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await ensureSeeded();
    const url = new URL(req.url);
    const jobs = await getJobs({
      status: url.searchParams.get("status") ?? undefined,
      dept: url.searchParams.get("dept") ?? undefined,
    });
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
