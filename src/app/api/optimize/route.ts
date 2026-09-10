import { NextResponse } from "next/server";
import { runOptimizer, runRollingPlan } from "@/lib/engine/optimizer";
import { ensureSeeded } from "@/lib/engine/seed";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json().catch(() => ({}))) as { horizon?: string };
    const horizon =
      body.horizon === "ROLLING" || body.horizon === "MONTHLY" || body.horizon === "WEEKLY"
        ? body.horizon
        : "WEEKLY";

    const response = horizon === "ROLLING"
      ? await runRollingPlan()
      : await runOptimizer(horizon);

    return NextResponse.json(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Optimizer error:", error);
    return NextResponse.json(
      {
        error: message || "Optimizer failed",
        log: ["Optimizer failed: " + message],
      },
      { status: 500 }
    );
  }
}
