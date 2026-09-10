import { NextResponse } from "next/server";
import { getJobs } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";

/**
 * Work orders for the Karmi and inspector pages.
 *
 * Returned raw rows before, so `segmentCode`, `corridor` and `escalationLevel` — which the job
 * cards render — were undefined. `getJobs()` supplies the DTO (including the escalation level the
 * T+15/T+30/T+60 timers depend on) and `{ jobs }` matches what `JobsClient` reads.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const jobs = await getJobs({
      status: url.searchParams.get("status") ?? undefined,
      dept: (url.searchParams.get("dept") as "ENG" | "TRD" | "SNT" | null) ?? undefined,
    });
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return NextResponse.json({ error: message, jobs: [], count: 0 }, { status: 500 });
  }
}
