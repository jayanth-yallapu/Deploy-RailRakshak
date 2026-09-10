import { NextResponse } from "next/server";
import { db } from "@/db";
import { blockItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ensureSeeded } from "@/lib/engine/seed";
import { getLatestPlan, policyEnv } from "@/lib/engine/optimizer";
import { POLICY_RULES, evaluatePlanPolicy } from "@/lib/engine/policy";

export const dynamic = "force-dynamic";

/**
 * Live compliance verdict for the current plan.
 *
 * Read-only by design: this is what the planner looks at before signing, so it must never have the
 * side effect of changing the plan it is judging.
 */
export async function GET() {
  try {
    await ensureSeeded();
    const plan = await getLatestPlan();
    if (!plan) return NextResponse.json({ error: "no plan yet — run the optimizer" }, { status: 404 });

    const rows = await db.select().from(blockItems).where(eq(blockItems.planId, plan.id));
    const env = await policyEnv();
    const report = evaluatePlanPolicy(
      rows.map((b) => ({
        id: b.id,
        segmentId: b.segmentId,
        day: b.day,
        startMin: b.startMin,
        endMin: b.endMin,
        departments: b.departments,
        mode: b.mode,
      })),
      env
    );

    return NextResponse.json({
      planId: plan.id,
      planName: plan.name,
      evaluatedAt: new Date().toISOString(),
      score: report.score,
      compliantBlocks: report.compliantBlocks,
      hardViolations: report.hardViolations,
      softWarnings: report.softWarnings,
      summary: report.summary,
      blocks: rows
        .map((b) => ({
          id: b.id,
          segmentId: b.segmentId,
          day: b.day,
          startMin: b.startMin,
          endMin: b.endMin,
          departments: b.departments,
          policy: report.perBlock[b.id] ?? null,
          overrideReason: b.overrideReason,
        }))
        .sort((a, b) => a.day - b.day || a.startMin - b.startMin),
      // The rule book itself: clause text, plus which conditional rules are live under the current
      // toggles — so "why isn't the fog rule firing?" has an answer on screen.
      rules: report.rules,
      activeRuleIds: POLICY_RULES.filter((r) => !r.applies || r.applies(env)).map((r) => r.id),
      dormantRuleIds: POLICY_RULES.filter((r) => r.applies && !r.applies(env)).map((r) => r.id),
      settings: env.settings,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
