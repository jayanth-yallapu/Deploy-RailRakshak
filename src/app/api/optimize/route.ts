import { NextResponse } from "next/server";
import { runOptimizer, runRollingPlan } from "@/lib/engine/optimizer";
import { ensureSeeded } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json().catch(() => ({}))) as { horizon?: string };
    const result =
      body.horizon === "ROLLING"
        ? await runRollingPlan()
        : await runOptimizer(body.horizon === "MONTHLY" ? "MONTHLY" : "WEEKLY");
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
