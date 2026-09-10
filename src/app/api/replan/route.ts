import { NextResponse } from "next/server";
import { ensureSeeded } from "@/lib/engine/seed";
import { getLatestPlan } from "@/lib/engine/optimizer";
import { latestDiff, planChain, replan } from "@/lib/engine/replan";

export const dynamic = "force-dynamic";

/** The plan chain and the most recent stored diff — read-only, safe to poll. */
export async function GET() {
  try {
    await ensureSeeded();
    const [chain, last] = await Promise.all([planChain(8), latestDiff()]);
    const plan = await getLatestPlan();
    return NextResponse.json({ chain, diff: last.diff, diffPlanId: last.planId, planId: plan?.id ?? null });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

/**
 * Reconcile the published plan with the live backlog, minimally.
 *
 * `POST /api/replan { mode?: "incremental"|"full", notify?: boolean, triggerNote?: string,
 *                    churnWeight?: number, dryRun?: boolean }`
 *
 * `incremental` (default) keeps every block the event does not concern in its notified slot and
 * charges the search for disturbing the rest; `full` is what clicking "Run Optimizer" does, so the
 * two together measure what stability costs. Blocks with crews signed on are held in both modes.
 */
export async function POST(req: Request) {
  try {
    await ensureSeeded();
    const body = (await req.json().catch(() => ({}))) as {
      mode?: string;
      notify?: boolean;
      triggerNote?: string;
      churnWeight?: number;
      dryRun?: boolean;
    };
    const result = await replan({
      mode: body.mode === "full" ? "full" : "incremental",
      notify: body.notify === true,
      triggerNote: typeof body.triggerNote === "string" ? body.triggerNote.slice(0, 240) : undefined,
      churnWeight: body.churnWeight != null && Number.isFinite(Number(body.churnWeight)) ? Number(body.churnWeight) : undefined,
      // A dry run computes the diff and the metrics and writes nothing — that is how the panel can show
      // "what a full re-optimisation would cost in churn" against the minimal edit, from the same start.
      dryRun: body.dryRun === true,
    });
    const plan = await getLatestPlan();
    return NextResponse.json({ ...result, plan });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
