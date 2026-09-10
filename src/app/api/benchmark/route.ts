import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/engine/seed";
import { getLatestBenchmark, runBenchmark } from "@/lib/engine/benchmark";

export const dynamic = "force-dynamic";

/** Latest stored benchmark run (no computation, no writes). */
export async function GET() {
  try {
    await ensureSeeded();
    const report = await getLatestBenchmark();
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Run the AI-vs-manual comparison and store it.
 * `POST { runs?: number, horizon?: "WEEKLY"|"MONTHLY", seed?: number }`
 *
 * Deterministic for a given seed: the same seed on the same lake reproduces the same report, which is
 * what makes the number quotable in a report instead of "the demo machine said something different".
 */
export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json().catch(() => ({}))) as { runs?: number; horizon?: string; seed?: number };
    const report = await runBenchmark({
      runs: Number(body.runs ?? 100),
      horizon: body.horizon === "MONTHLY" ? "MONTHLY" : "WEEKLY",
      seed: Number(body.seed ?? 1),
    });
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
